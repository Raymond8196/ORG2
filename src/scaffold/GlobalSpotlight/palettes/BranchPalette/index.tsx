/**
 * BranchPalette Component
 *
 * Unified branch palette component used by both:
 * - Global toolbar (variant="global"): checkout, create, create-from, remove modes
 * - Create session (variant="create-session"): checkout and create modes
 *
 * All variants fetch branches through the Rust git API
 * (`gitApi.getGitBranches`) and share the centralized branch cache to
 * prevent redundant calls.
 */
import { Folder, FolderPlus } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import WorktreeSourceModal from "@src/features/SessionCreator/components/WorktreeSourceModal";
import { useFilteredItems } from "@src/hooks/search";
import type { WorktreeLaunchSource } from "@src/store/session/worktreeLaunchSourceAtom";
import { compactRepoPathForDisplay } from "@src/util/file/repoPathDisplay";

import {
  SPOTLIGHT_FOOTER_ACTIVE_CHIP,
  SpotlightPinnedActionSection,
} from "../../components";
import { SPOTLIGHT_CLASSES, SPOTLIGHT_TOKENS } from "../../constants";
import { PaletteBody, SpotlightShell } from "../../shell";
import type { SpotlightItem } from "../../types";
import { useSelectorKernel } from "../core";
import type { BranchPaletteProps, WorktreePaletteProps } from "./types";
import { useBranchPalette } from "./useBranchPalette";
import { useWorktreeEntries } from "./useWorktreeMap";

function normalizeWorktreePath(path: string | undefined): string {
  return (path ?? "").replace(/^file:\/\//, "").replace(/\/+$/, "");
}

export const WorktreePalette: React.FC<WorktreePaletteProps> = ({
  isOpen,
  onClose,
  onGoBackToParent,
  repoId,
  repoPath,
  activePath,
  onSelect,
  onCreate,
  asBody = false,
}) => {
  const { t } = useTranslation();
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const worktrees = useWorktreeEntries({
    enabled: isOpen,
    repoId,
    repoPath,
    isLocalRepo: true,
  });
  const allItems = React.useMemo<SpotlightItem[]>(
    () =>
      worktrees.map((worktree) => {
        const path = normalizeWorktreePath(worktree.path);
        const label =
          worktree.branch ||
          (worktree.is_main
            ? t("selectors.branch.labels.mainWorktree", "Main")
            : path.split("/").pop() || path);
        const isSelected =
          path === normalizeWorktreePath(activePath || repoPath);
        return {
          id: `worktree:${path}`,
          label,
          desc: compactRepoPathForDisplay({ path }),
          icon: Folder,
          type: "option" as const,
          data: {
            isSelector: true,
            isCurrentSelection: isSelected,
            rightContent: isSelected ? (
              <span
                className={`${SPOTLIGHT_CLASSES.primaryPill} ${SPOTLIGHT_TOKENS.badgeFontSize} shrink-0 font-medium`}
              >
                {t("selectors.branch.labels.current", "Current")}
              </span>
            ) : undefined,
          },
          action: () => {
            void Promise.resolve(onSelect(worktree)).then(onClose);
          },
        };
      }),
    [activePath, onClose, onSelect, repoPath, t, worktrees]
  );
  // The main worktree is grouped separately from linked (secondary) ones.
  const mainWorktreeIds = React.useMemo(
    () =>
      new Set(
        worktrees
          .filter((worktree) => worktree.is_main)
          .map((worktree) => `worktree:${normalizeWorktreePath(worktree.path)}`)
      ),
    [worktrees]
  );
  const { filteredItems } = useFilteredItems({
    items: allItems,
    searchQuery,
    getSearchText: (item) => `${item.label} ${item.desc ?? ""}`,
  });
  const sectionedItems = React.useMemo<SpotlightItem[]>(() => {
    const header = (id: string, label: string): SpotlightItem => ({
      id,
      label,
      desc: "",
      icon: "",
      type: "option" as const,
      data: { isHeader: true },
      action: () => {},
    });
    const mainItems = filteredItems.filter((item) =>
      mainWorktreeIds.has(item.id)
    );
    const linkedItems = filteredItems.filter(
      (item) => !mainWorktreeIds.has(item.id)
    );
    const list: SpotlightItem[] = [];
    if (mainItems.length > 0) {
      list.push(
        header(
          "worktree:header-main",
          t("selectors.branch.labels.mainWorktreeSection", "Main worktree")
        ),
        ...mainItems
      );
    }
    if (linkedItems.length > 0) {
      list.push(
        header(
          "worktree:header-linked",
          t("selectors.branch.labels.linkedWorktrees", "Linked worktrees")
        ),
        ...linkedItems
      );
    }
    return list;
  }, [filteredItems, mainWorktreeIds, t]);
  const createAction = React.useMemo<SpotlightItem>(
    () => ({
      id: "worktree:new",
      label: t("selectors.branch.actions.newWorktree", "New Worktree..."),
      icon: FolderPlus,
      type: "action",
      data: { showDisclosureChevron: true },
      action: () => setCreateModalOpen(true),
    }),
    [t]
  );
  const selectableItems = React.useMemo<SpotlightItem[]>(
    () => (onCreate ? [...sectionedItems, createAction] : sectionedItems),
    [createAction, onCreate, sectionedItems]
  );
  const kernel = useSelectorKernel({
    isOpen,
    onClose,
    items: selectableItems,
    hasModalState: true,
    onGoBack: onGoBackToParent ?? onClose,
    isItemSelectable: (item) => !item.data?.isHeader,
    externalSearchQuery: searchQuery,
    externalSetSearchQuery: setSearchQuery,
  });

  const pinnedActionSection = onCreate ? (
    <SpotlightPinnedActionSection
      items={[createAction]}
      startIndex={sectionedItems.length}
      selectedIndex={kernel.selectedIndex}
      onItemSelect={kernel.handleItemClick}
      onItemHover={kernel.setSelectedIndex}
      searchQuery={searchQuery}
    />
  ) : undefined;

  const handleCreateSourceSelect = React.useCallback(
    (source: WorktreeLaunchSource) => {
      setCreateModalOpen(false);
      void Promise.resolve(onCreate?.(source));
    },
    [onCreate]
  );

  const body = (
    <PaletteBody
      kernel={kernel}
      items={sectionedItems}
      placeholder={t(
        "selectors.spotlight.placeholders.worktree",
        "Search worktree..."
      )}
      path={[
        {
          type: "action",
          id: "switch-worktree",
          label: t("selectors.branch.path.switchWorktree", "Switch worktree"),
          icon: Folder,
          color: "",
          data: {
            template: t(
              "selectors.branch.path.switchWorktreeTemplate",
              "Switch to {worktree}"
            ),
            requiredParams: ["worktree"],
          },
        },
      ]}
      onRemoveSegment={() => (onGoBackToParent ?? onClose)()}
      isLoading={isOpen && worktrees.length === 0}
      fixedHeight
      afterListSlot={pinnedActionSection}
    />
  );

  const palette = (
    <>
      {body}
      {createModalOpen && (
        <WorktreeSourceModal
          open
          repoId={repoId}
          repoPath={repoPath}
          branchName={
            worktrees.find(
              (worktree) =>
                normalizeWorktreePath(worktree.path) ===
                normalizeWorktreePath(activePath || repoPath)
            )?.branch
          }
          onClose={() => setCreateModalOpen(false)}
          onSelect={({ source }) => handleCreateSourceSelect(source)}
        />
      )}
    </>
  );

  if (asBody) return palette;

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={onClose}
      hasActiveAction
      activeActionChip={SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection}
    >
      {palette}
    </SpotlightShell>
  );
};

// ============ COMPONENT ============

export const BranchPalette: React.FC<BranchPaletteProps> = ({
  isOpen,
  onClose,
  onSelect,
  repoId,
  repoPath: repoPathProp,
  currentBranchName,
  groupWorktreeBranches = true,
  onCreateBranch,
  onDeleteBranch,
  onRemoveWorktree,
  onCheckoutDetached,
  githubConnectionId,
  githubRepoFullName,
  variant = "global",
  showRemoveMode,
  asBody = false,
  hideActionClose = false,
  onModeChange,
  onGoBackToParent,
}) => {
  const effectiveShowRemoveMode = showRemoveMode ?? variant === "global";

  const {
    kernel,
    activeMode,
    setActiveMode,
    isCreatingBranch,
    setSelectedStartPoint,
    items,
    pinnedActionItems,
    isLoading,
    getPath,
    getPlaceholder,
  } = useBranchPalette({
    isOpen,
    repoId,
    repoPathProp,
    currentBranchName,
    groupWorktreeBranches,
    onSelect,
    onCreateBranch,
    onDeleteBranch,
    onRemoveWorktree,
    onCheckoutDetached,
    onClose,
    onGoBackToParent,
    variant,
    effectiveShowRemoveMode,
    parentModalState: asBody || !!onGoBackToParent,
    githubConnectionId,
    githubRepoFullName,
  });

  React.useEffect(() => {
    onModeChange?.(activeMode);
  }, [activeMode, onModeChange]);

  const handleRemovePathSegment = React.useCallback(() => {
    if (activeMode === "checkout") {
      if (onGoBackToParent) {
        onGoBackToParent();
        return;
      }
      onClose();
      return;
    }
    setSelectedStartPoint(null);
    setActiveMode("checkout");
    kernel.setSearchQuery("");
  }, [
    activeMode,
    kernel,
    onClose,
    onGoBackToParent,
    setActiveMode,
    setSelectedStartPoint,
  ]);

  const pinnedActionStartIndex = items.length;
  const pinnedActionSection =
    activeMode === "checkout" || activeMode === "remove" ? (
      <SpotlightPinnedActionSection
        items={pinnedActionItems}
        startIndex={pinnedActionStartIndex}
        selectedIndex={kernel.selectedIndex}
        onItemSelect={kernel.handleItemClick}
        onItemHover={kernel.setSelectedIndex}
        searchQuery={kernel.searchQuery}
        layout="twoColumn"
      />
    ) : undefined;

  const body = (
    <PaletteBody
      kernel={kernel}
      items={items}
      placeholder={getPlaceholder()}
      path={getPath()}
      onRemoveSegment={handleRemovePathSegment}
      isLoading={isLoading || isCreatingBranch}
      hideActionClose={hideActionClose}
      containerHeight={350}
      fixedHeight
      contentOverride={activeMode === "add" ? <></> : undefined}
      afterListSlot={pinnedActionSection}
    />
  );

  if (asBody) return body;

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={onClose}
      hasActiveAction={
        (activeMode === "checkout" || activeMode === "remove") &&
        pinnedActionItems.length > 0
      }
      activeActionChip={SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection}
    >
      {body}
    </SpotlightShell>
  );
};

export type {
  BranchPaletteProps,
  BranchPaletteMode,
  WorktreePaletteProps,
} from "./types";

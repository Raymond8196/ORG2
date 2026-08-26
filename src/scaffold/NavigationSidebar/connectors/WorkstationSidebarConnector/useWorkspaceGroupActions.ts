/**
 * Workspace group header affordances for the sidebar's Organize-by-workspace
 * view: the hover `…` (pin / hide) and `+` (start a session sourced at that
 * workspace) actions on each group separator.
 *
 * Pinning and hiding are the two ends of one ordering preference — pinned
 * groups sort above everything, hidden ones below — so they are mutually
 * exclusive: applying one clears the other rather than leaving a key in a
 * state whose rendered position depends on which check runs first.
 *
 * Neither is a filter. A hidden group keeps rendering, sorted last and
 * collapsed, so nothing becomes unreachable and the state is reversible from
 * the same menu. The persisted hidden set is mirrored into the sidebar's
 * collapsed-section ids, which is what actually folds the group: a workspace
 * group's section id IS its workspace key.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { createLogger } from "@src/hooks/logger";
import { reposAtom } from "@src/store/repo";
import {
  SESSION_SOURCE_TYPE,
  sessionSourceAtom,
} from "@src/store/session/creatorStateAtom";
import { popupNativeMenu } from "@src/util/platform/tauri/nativeMenuPopup";

import {
  sidebarHiddenWorkspacesAtom,
  sidebarPinnedWorkspacesAtom,
} from "../sidebarGroupByAtom";
import { NO_WORKSPACE_KEY } from "../types";
import type { WorkspaceGroupActions } from "../useSessionMenuItems/types";

const logger = createLogger("WorkspaceGroupActions");

interface UseWorkspaceGroupActionsParams {
  /** Labels are resolved by the connector so this hook stays i18n-free. */
  createSessionLabel: string;
  moreActionsLabel: string;
  pinLabel: string;
  unpinLabel: string;
  hideLabel: string;
  unhideLabel: string;
  /** The sidebar's own "new session" entry point (`openNewChatFromSidebar`). */
  openNewSession: () => void;
  setCollapsedSectionIds: (
    updater: (previous: Set<string>) => Set<string>
  ) => void;
}

export function useWorkspaceGroupActions({
  createSessionLabel,
  moreActionsLabel,
  pinLabel,
  unpinLabel,
  hideLabel,
  unhideLabel,
  openNewSession,
  setCollapsedSectionIds,
}: UseWorkspaceGroupActionsParams): WorkspaceGroupActions {
  const [hiddenWorkspaces, setHiddenWorkspaces] = useAtom(
    sidebarHiddenWorkspacesAtom
  );
  const [pinnedWorkspaces, setPinnedWorkspaces] = useAtom(
    sidebarPinnedWorkspacesAtom
  );
  const repos = useAtomValue(reposAtom);
  const setSessionSource = useSetAtom(sessionSourceAtom);

  const hiddenWorkspaceKeys = useMemo(
    () => new Set(hiddenWorkspaces),
    [hiddenWorkspaces]
  );
  const pinnedWorkspaceKeys = useMemo(
    () => new Set(pinnedWorkspaces),
    [pinnedWorkspaces]
  );

  // Seed the collapsed set from the persisted hidden set once per mount, so a
  // workspace hidden in an earlier run comes back folded. Later toggles are
  // driven by the menu handler below, not by this effect — re-running it would
  // fight a viewer who deliberately expanded a hidden group.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || hiddenWorkspaceKeys.size === 0) return;
    seededRef.current = true;
    setCollapsedSectionIds((previous) => {
      const next = new Set(previous);
      for (const key of hiddenWorkspaceKeys) next.add(key);
      return next;
    });
  }, [hiddenWorkspaceKeys, setCollapsedSectionIds]);

  const onCreateSession = useCallback(
    (workspaceKey: string) => {
      if (workspaceKey === NO_WORKSPACE_KEY) return;
      const repo = repos.find(
        (candidate) =>
          (candidate.path ?? candidate.fs_uri ?? "").replace(/\/+$/, "") ===
          workspaceKey
      );
      // Writes the creator's source divergence only — never the global repo
      // selection, which stays the user's own explicit choice (see the
      // `sessionSourceAtom` contract in `useSessionCreator`). A group can be
      // headed by a path that was never added as a repo (an imported
      // session's cwd); the creator still accepts it as a local source, only
      // the repo id is unavailable.
      setSessionSource({
        type: SESSION_SOURCE_TYPE.LOCAL,
        repoId: repo?.id,
        repoName: repo?.name ?? workspaceKey.split("/").pop() ?? workspaceKey,
        repoPath: workspaceKey,
      });
      openNewSession();
    },
    [openNewSession, repos, setSessionSource]
  );

  /** Add or drop `key` in a persisted key list, without duplicating it. */
  const toggleKey = useCallback(
    (
      setKeys: (updater: (previous: string[]) => string[]) => void,
      key: string,
      present: boolean
    ) => {
      setKeys((previous) =>
        present
          ? previous.filter((candidate) => candidate !== key)
          : [...previous.filter((candidate) => candidate !== key), key]
      );
    },
    []
  );

  const setSectionCollapsed = useCallback(
    (key: string, collapsed: boolean) => {
      setCollapsedSectionIds((previous) => {
        const next = new Set(previous);
        if (collapsed) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
    [setCollapsedSectionIds]
  );

  const onOpenMenu = useCallback(
    (workspaceKey: string) => {
      const isPinned = pinnedWorkspaceKeys.has(workspaceKey);
      const isHidden = hiddenWorkspaceKeys.has(workspaceKey);
      void popupNativeMenu({
        source: "sidebar-workspace-group",
        buildItems: () => [
          {
            text: isPinned ? unpinLabel : pinLabel,
            action: () => {
              toggleKey(setPinnedWorkspaces, workspaceKey, isPinned);
              if (isPinned) return;
              // Pinning a hidden group lifts it out of hiding, and a group
              // the viewer just pinned should be readable, not folded.
              toggleKey(setHiddenWorkspaces, workspaceKey, true);
              setSectionCollapsed(workspaceKey, false);
            },
          },
          {
            text: isHidden ? unhideLabel : hideLabel,
            action: () => {
              toggleKey(setHiddenWorkspaces, workspaceKey, isHidden);
              setSectionCollapsed(workspaceKey, !isHidden);
              if (!isHidden) toggleKey(setPinnedWorkspaces, workspaceKey, true);
            },
          },
        ],
      }).catch((error: unknown) => {
        logger.warn("workspace group menu failed to open:", error);
      });
    },
    [
      hiddenWorkspaceKeys,
      hideLabel,
      pinLabel,
      pinnedWorkspaceKeys,
      setHiddenWorkspaces,
      setPinnedWorkspaces,
      setSectionCollapsed,
      toggleKey,
      unhideLabel,
      unpinLabel,
    ]
  );

  return useMemo(
    () => ({
      pinnedWorkspaceKeys,
      hiddenWorkspaceKeys,
      onCreateSession,
      onOpenMenu,
      createSessionLabel,
      moreActionsLabel,
    }),
    [
      createSessionLabel,
      hiddenWorkspaceKeys,
      moreActionsLabel,
      onCreateSession,
      onOpenMenu,
      pinnedWorkspaceKeys,
    ]
  );
}

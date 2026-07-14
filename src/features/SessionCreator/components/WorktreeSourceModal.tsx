import {
  CaseSensitive,
  Check,
  CircleDot,
  Cloud,
  GitBranch,
  GitFork,
  GitPullRequest,
  Github,
  Hash,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { resolvePrWorktreeBase } from "@src/api/tauri/github";
import type { GitHubIssue, OpenPRItem } from "@src/api/tauri/github";
import Button from "@src/components/Button";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_SEARCH,
} from "@src/components/Dropdown/tokens";
import Input from "@src/components/Input";
import { useWorktreeMap } from "@src/scaffold/GlobalSpotlight/palettes/BranchPalette/useWorktreeMap";
import Modal from "@src/scaffold/ModalSystem";
import type {
  WorktreeCreateSourceKind,
  WorktreeLaunchSource,
} from "@src/store/session/worktreeLaunchSourceAtom";

import { useWorktreeSourceData } from "./useWorktreeSourceData";
import {
  type WorktreeBranchOption,
  branchToLaunchSource,
  compactText,
  customRefToLaunchSource,
  filterBranchOptions,
  formatBranchTimestamp,
  groupBranchOptions,
  shouldOfferCustomRef,
} from "./worktreeBranchSource";
import {
  type PrResolveMeta,
  type SmartIssueInput,
  type SmartPrInput,
  type SmartSuggestionKind,
  type SmartSuggestionSources,
  buildSmartSuggestions,
  nameToLaunchSource,
} from "./worktreeSmartInput";
import {
  isPrSource,
  mergeResolvedPrBase,
  prNumberFromSourceRef,
} from "./worktreeSourceResolve";

export interface WorktreeSourceModalProps {
  open: boolean;
  repoId?: string;
  repoName?: string;
  repoPath?: string;
  branchName?: string;
  onClose: () => void;
  onSelect: (source: WorktreeLaunchSource) => void;
}

interface GitHubWorktreeItem {
  id: string;
  icon: React.ReactNode;
  source: WorktreeLaunchSource;
  detail: string;
  searchableText: string;
  /** Present only for PR rows â€” drives `worktree_resolve_pr_base` on confirm. */
  pr?: PrResolveMeta;
}

interface SourceTab {
  id: WorktreeCreateSourceKind;
  label: string;
  icon: React.ReactNode;
}

/** English fallbacks for the Branch-tab section labels (common-ns i18n keys). */
const BRANCH_GROUP_LABEL_FALLBACK: Record<
  "recent" | "worktrees" | "otherBranches",
  string
> = {
  recent: "Recent",
  worktrees: "Worktrees",
  otherBranches: "Other Branches",
};

/** Stable ids so the visible `<label>`s associate with their DS `Input`s. */
const SMART_INPUT_ID = "worktree-source-smart-input";
const BRANCH_SEARCH_INPUT_ID = "worktree-source-branch-search";
const NAME_INPUT_ID = "worktree-source-name-input";

function normalizeBaseBranch(branchName?: string): string | undefined {
  const trimmed = branchName?.trim();
  return trimmed || undefined;
}

function smartIcon(kind: SmartSuggestionKind): React.ReactNode {
  switch (kind) {
    case "pr":
      return <GitPullRequest size={14} strokeWidth={1.75} />;
    case "issue":
      return <CircleDot size={14} strokeWidth={1.75} />;
    case "branch":
      return <GitBranch size={14} strokeWidth={1.75} />;
    case "customRef":
      return <Hash size={14} strokeWidth={1.75} />;
    case "name":
      return <CaseSensitive size={14} strokeWidth={1.75} />;
    default:
      return <Sparkles size={14} strokeWidth={1.75} />;
  }
}

function sourceKey(source: WorktreeLaunchSource): string {
  return [
    source.kind,
    source.sourceRef ?? "",
    source.baseBranch ?? "",
    source.label,
  ].join(":");
}

function githubPrToItem(pr: OpenPRItem): GitHubWorktreeItem {
  const label = compactText(`#${pr.number} ${pr.title}`);
  const detail = `${pr.head_branch} -> ${pr.base_branch}`;
  return {
    id: `pr:${pr.number}`,
    icon: <GitPullRequest size={14} strokeWidth={1.75} />,
    source: {
      kind: "github",
      label,
      baseBranch: pr.head_branch || pr.base_branch,
      sourceRef: `pr:${pr.number}`,
      title: pr.title,
    },
    detail,
    searchableText: `${label} ${detail}`,
    pr: {
      prNumber: pr.number,
      headBranch: pr.head_branch || undefined,
      baseBranch: pr.base_branch || undefined,
    },
  };
}

function githubIssueToItem(
  issue: GitHubIssue,
  baseBranch?: string
): GitHubWorktreeItem {
  const label = compactText(`#${issue.number} ${issue.title}`);
  const detail = baseBranch ? `Issue - Base: ${baseBranch}` : "Issue";
  return {
    id: `issue:${issue.number}`,
    icon: <CircleDot size={14} strokeWidth={1.75} />,
    source: {
      kind: "github",
      label,
      baseBranch,
      sourceRef: `issue:${issue.number}`,
      title: issue.title,
    },
    detail,
    searchableText: `${label} ${detail}`,
  };
}

/**
 * Shared list-container classes for every tab's result list. A single
 * token-backed bordered scroll region (border + `bg-bg-2` + `max-h` cap +
 * internal scroll) so all four tabs render their `SourceRow`s inside the
 * exact same wrapper â€” no per-tab drift. Consumed via `SourceList`.
 */
const SOURCE_LIST_CLASS = `min-h-0 flex-1 ${DROPDOWN_PANEL.optionsMaxHeightClass} overflow-y-auto rounded-lg border border-border-2 bg-bg-2 p-1`;

/** Bordered, height-capped, internally-scrolling list wrapper shared by all tabs. */
const SourceList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={SOURCE_LIST_CLASS}>{children}</div>
);

/** Refresh control rendered inside DS `Input` suffix â€” matches input row height. */
const SourceRefreshSuffix: React.FC<{
  disabled?: boolean;
  refreshing?: boolean;
  ariaLabel: string;
  onClick: () => void;
}> = ({ disabled, refreshing, ariaLabel, onClick }) => (
  <button
    type="button"
    className="inline-flex shrink-0 items-center justify-center border-none bg-transparent p-0 text-text-3 transition-colors hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
    disabled={disabled}
    aria-label={ariaLabel}
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
  >
    <RefreshCw
      size={DROPDOWN_SEARCH.iconSize}
      strokeWidth={1.75}
      className={refreshing ? "animate-spin" : undefined}
    />
  </button>
);

const SourceRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  detail?: string;
  /** Optional right-aligned metadata (e.g. relative "last commit" timestamp). */
  meta?: string;
  selected: boolean;
  onClick: () => void;
}> = ({ icon, title, detail, meta, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center py-1 text-left ${DROPDOWN_ITEM.minHeightClass} ${DROPDOWN_ITEM.gapClass} ${DROPDOWN_ITEM.paddingXClass} ${DROPDOWN_ITEM.borderRadiusClass} ${DROPDOWN_ITEM.transitionClass} ${
      selected
        ? "bg-surface-hover text-text-1"
        : "text-text-2 hover:bg-surface-hover hover:text-text-1"
    }`}
  >
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-3">
      {icon}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] font-medium leading-5 text-text-1">
        {title}
      </span>
      {detail && (
        <span className="block truncate text-[12px] leading-4 text-text-3">
          {detail}
        </span>
      )}
    </span>
    {meta && (
      <span className="shrink-0 text-[12px] tabular-nums leading-4 text-text-3">
        {meta}
      </span>
    )}
    {selected && (
      <Check size={14} strokeWidth={1.75} className="shrink-0 text-primary-6" />
    )}
  </button>
);

/**
 * Icon for a branch row â€” distinguishes worktree / remote (origin) / local by
 * glyph instead of a "Local branch" / "Remote branch" text subtitle, matching
 * the Spotlight branch selector's icon-first rows.
 */
function branchRowIcon(option: WorktreeBranchOption): React.ReactNode {
  if (option.worktreePath) return <GitFork size={14} strokeWidth={1.75} />;
  if (option.isRemote) return <Cloud size={14} strokeWidth={1.75} />;
  return <GitBranch size={14} strokeWidth={1.75} />;
}

const WorktreeSourceModal: React.FC<WorktreeSourceModalProps> = ({
  open,
  repoId,
  repoName,
  repoPath,
  branchName,
  onClose,
  onSelect,
}) => {
  const { t } = useTranslation("sessions");
  const [activeTab, setActiveTab] = useState<WorktreeCreateSourceKind>("smart");
  const [selectedSource, setSelectedSource] =
    useState<WorktreeLaunchSource | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [smartQuery, setSmartQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const { github: githubData, branch: branchData } = useWorktreeSourceData({
    open,
    repoId,
    repoPath,
  });

  const githubItems = useMemo(() => {
    const base = normalizeBaseBranch(branchName);
    return [
      ...githubData.prs.map(githubPrToItem),
      ...githubData.issues.map((issue) => githubIssueToItem(issue, base)),
    ];
  }, [branchName, githubData.issues, githubData.prs]);

  const githubState = githubData.state;
  const githubError = githubData.error;
  const repoFullName = githubData.repoFullName;
  const branchOptions = branchData.options;
  const branchState = branchData.state;
  const branchError = branchData.error;

  const tabs = useMemo<SourceTab[]>(
    () => [
      {
        id: "smart",
        label: t("creator.worktreeSource.tabs.smart", {
          defaultValue: "Smart",
        }),
        icon: <Sparkles size={14} strokeWidth={1.75} />,
      },
      {
        id: "github",
        label: t("creator.worktreeSource.tabs.github", {
          defaultValue: "GitHub",
        }),
        icon: <Github size={14} strokeWidth={1.75} />,
      },
      {
        id: "branch",
        label: t("creator.worktreeSource.tabs.branch", {
          defaultValue: "Branch",
        }),
        icon: <GitBranch size={14} strokeWidth={1.75} />,
      },
      {
        id: "name",
        label: t("creator.worktreeSource.tabs.name", {
          defaultValue: "Name",
        }),
        icon: <CaseSensitive size={14} strokeWidth={1.75} />,
      },
    ],
    [t]
  );

  const filteredGithubItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return githubItems;
    return githubItems.filter((item) =>
      item.searchableText.toLowerCase().includes(query)
    );
  }, [githubItems, searchQuery]);

  // Branchâ†’worktree-path map (local repos), reused from the Spotlight branch
  // selector so the Branch tab can surface a Worktrees section. Best-effort:
  // an empty map just means no Worktrees group is shown.
  const worktreeMap = useWorktreeMap({
    enabled: open && Boolean(repoPath),
    repoId: repoId || "default",
    repoPath,
    isLocalRepo: true,
  });

  const filteredBranchOptions = useMemo(
    () => filterBranchOptions(branchOptions, branchQuery),
    [branchOptions, branchQuery]
  );

  // Recent / Worktrees / Other sections, categorised exactly like the
  // Spotlight branch selector (`categorizeBranches`), with worktree paths
  // merged onto matching local branches.
  const branchGroups = useMemo(
    () => groupBranchOptions(filteredBranchOptions, worktreeMap),
    [filteredBranchOptions, worktreeMap]
  );

  // Visual order across all sections â€” drives the default (fallback) selection.
  const orderedBranchOptions = useMemo(
    () => branchGroups.flatMap((group) => group.options),
    [branchGroups]
  );

  const offerCustomRef = useMemo(
    () => shouldOfferCustomRef(branchQuery, branchOptions),
    [branchOptions, branchQuery]
  );

  const customRefSource = useMemo(
    () => customRefToLaunchSource(branchQuery),
    [branchQuery]
  );

  // Confirm target for the Branch tab: an explicit click wins; otherwise the
  // first branch in the grouped list; otherwise the typed custom ref; otherwise
  // the current branch (as a ref) so the tab is never dead on open.
  const branchFallback = useMemo<WorktreeLaunchSource | null>(() => {
    if (orderedBranchOptions.length > 0) {
      return branchToLaunchSource(orderedBranchOptions[0]);
    }
    if (offerCustomRef && customRefSource) return customRefSource;
    const base = normalizeBaseBranch(branchName);
    return base ? customRefToLaunchSource(base) : null;
  }, [branchName, customRefSource, orderedBranchOptions, offerCustomRef]);

  const nameSource = useMemo<WorktreeLaunchSource | null>(
    () => nameToLaunchSource(nameInput, branchName),
    [branchName, nameInput]
  );

  // Feed the loaded GitHub PRs/issues + branches (already fetched by the
  // effects above) into the pure smart-suggestion builder. Reusing the same
  // `githubItems`/`branchOptions` avoids a second fetch.
  const smartSuggestionSources = useMemo<SmartSuggestionSources>(() => {
    const prs: SmartPrInput[] = [];
    const issues: SmartIssueInput[] = [];
    for (const item of githubItems) {
      if (item.pr) {
        prs.push({
          number: item.pr.prNumber,
          title: item.source.title ?? "",
          headBranch: item.pr.headBranch ?? "",
          baseBranch: item.pr.baseBranch ?? "",
        });
      } else if (item.source.sourceRef?.startsWith("issue:")) {
        const number = Number.parseInt(
          item.source.sourceRef.slice("issue:".length),
          10
        );
        if (Number.isInteger(number)) {
          issues.push({ number, title: item.source.title ?? "" });
        }
      }
    }
    return {
      prs,
      issues,
      branches: branchOptions,
      branchName: normalizeBaseBranch(branchName),
      repoName,
      repoFullName: repoFullName ?? undefined,
    };
  }, [branchName, branchOptions, githubItems, repoFullName, repoName]);

  const smartSuggestions = useMemo(
    () => buildSmartSuggestions(smartQuery, smartSuggestionSources),
    [smartQuery, smartSuggestionSources]
  );

  // Tab switching resets `selectedSource` to null, so a non-null selection
  // always belongs to the active tab â€” no kind check needed (the Smart tab's
  // selection can be any kind: pr / branch / name / customRef).
  const selectedForActiveTab = selectedSource;

  const fallbackSource = useMemo<WorktreeLaunchSource | null>(() => {
    if (selectedForActiveTab) return selectedForActiveTab;
    if (activeTab === "smart") return smartSuggestions[0]?.source ?? null;
    if (activeTab === "github") return filteredGithubItems[0]?.source ?? null;
    if (activeTab === "branch") return branchFallback;
    return nameSource;
  }, [
    activeTab,
    branchFallback,
    filteredGithubItems,
    nameSource,
    selectedForActiveTab,
    smartSuggestions,
  ]);

  const prMetaBySourceRef = useMemo(() => {
    const map = new Map<string, PrResolveMeta>();
    for (const item of githubItems) {
      if (item.pr && item.source.sourceRef) {
        map.set(item.source.sourceRef, item.pr);
      }
    }
    // Smart PR suggestions carry their own resolve meta (including generic
 ç¿m¢G§²ÚîÆ­y×'DÆöF–ærĞ¢6Ö'E7VvvW7F–öç2æÆVæwF‚ÓÓÒb`¢‚†v—F‡V%7FFRÓÓÒ&ÆöF–ær"bbv—F‡V$—FV×2æÆVæwF‚ÓÓÒ’ÇÀ¢†'&æ6…7FFRÓÓÒ&ÆöF–ær"bb'&æ6„÷F–öç2æÆVæwF‚ÓÓÒ’“° ¢&WGW&â€¢ÆF—b6Æ74æÖSÒ&fÆW‚Ö–âÖ‚Õ³#S…ÒfÆW‚Ö6öÂvÓ"#à¢ÆÆ&VÀ¢‡FÖÄf÷#×µ4Ô%Eô”åUEô”GĞ¢6Æ74æÖSÒ'FW‡BÕ³'…ÒföçBÖÖVF—VÒFW‡B×FW‡BÓ2 ¢à¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Rç6Ö'DÆ&VÂ"Â°¢FVfVÇEfÇVS¢$æÖRÂçVÖ&W"Â'&æ6‚Â÷"U$Â"À¢Ò—Ğ¢ÂöÆ&VÃà¢Ä–çW@¢–C×µ4Ô%Eô”åUEô”GĞ¢G—SÒ'6V&6‚ ¢fÇVS×·6Ö'EVW'—Ğ¢öä6†ævS×²‡fÇVR’Óâ°¢6WE6Ö'EVW'’‡fÇVR“°¢6WE6VÆV7FVE6÷W&6R†çVÆÂ“°¢6WE&W6öÇfTW'&÷"†çVÆÂ“°¢×Ğ¢ÆÆ÷t6ÆV ¢&Vf—ƒ×°¢Å7&¶ÆW26—¦S×´E$õDõtåõ4T$4‚æ–6öå6—¦WÒ7G&ö¶Uv–GFƒ×³ãsWÒóà¢Ğ¢Æ6V†öÆFW#×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Rç6Ö'EÆ6V†öÆFW""Â°¢FVfVÇEfÇVS¢$æÖRÂ3#3BÂ'&æ6‚Â÷"v—D‡V"ôv—DÆ"U$Â"À¢Ò—Ğ¢&–ÖÆ&VÃ×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Rç6Ö'D&–"Â°¢FVfVÇEfÇVS ¢$VçFW"æÖRÂ"çVÖ&W"Â'&æ6‚Â÷"v—D‡V"ôv—DÆ"U$Â"À¢Ò—Ğ¢óà ¢Å6÷W&6TÆ—7Cà¢·6Ö'DÆöF–ærbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"FW‡B×FW‡BÓ2#à¢ÄÆöFW#"6—¦S×³gÒ6Æ74æÖSÒ&æ–ÖFR×7–â"óà¢ÂöF—cà¢—Ğ ¢²6Ö'DÆöF–ærbb6Ö'E7VvvW7F–öç2æÆVæwF‚ÓÓÒbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"‚ÓBFW‡BÖ6VçFW"FW‡BÕ³7…ÒFW‡B×FW‡BÓ2#à¢¶'&æ6…7FFRÓÓÒ&W'&÷" ¢ò'&æ6„W'&÷"ÇÀ¢B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6„W'&÷""Â°¢FVfVÇEfÇVS¢$'&æ6†W26÷VÆBæ÷B&RÆöFVBâ"À¢Ò¢¢B‚&7&VF÷"çv÷&·G&VU6÷W&6Rç6Ö'D†–çB"Â°¢FVfVÇEfÇVS ¢%G—RæÖRÂ"çVÖ&W"Â'&æ6‚Â÷"7FR"ôÕ"U$Ââ"À¢Ò—Ğ¢ÂöF—cà¢—Ğ ¢²6Ö'DÆöF–ærbb6Ö'E7VvvW7F–öç2æÆVæwF‚âbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚fÆW‚Ö6öÂvÓãR#à¢·6Ö'E7VvvW7F–öç2æÖ‚‡7VvvW7F–öâ’Óâ€¢Å6÷W&6U&÷p¢¶W“×·7VvvW7F–öâæ–GĞ¢–6öã×·6Ö'D–6öâ‡7VvvW7F–öâæ¶–æB—Ğ¢F—FÆS×·7VvvW7F–öâçF—FÆWĞ¢6VÆV7FVC×°¢6÷W&6T¶W’†fÆÆ&6µ6÷W&6Róò7VvvW7F–öâç6÷W&6R’ÓÓĞ¢6÷W&6T¶W’‡7VvvW7F–öâç6÷W&6R¢Ğ¢öä6Æ–6³×²‚’Óâ°¢6WE6VÆV7FVE6÷W&6R‡7VvvW7F–öâç6÷W&6R“°¢6WE&W6öÇfTW'&÷"†çVÆÂ“°¢×Ğ¢óà¢’—Ğ¢ÂöF—cà¢—Ğ¢Âõ6÷W&6TÆ—7Cà¢ÂöF—cà¢“°¢Ó° ¢6öç7B&VæFW$v—F‡V%F"Ò‚’Óâ€¢ÆF—b6Æ74æÖSÒ&fÆW‚Ö–âÖ‚Õ³#S…ÒfÆW‚Ö6öÂvÓ"#à¢Ä–çW@¢G—SÒ'6V&6‚ ¢fÇVS×·6V&6…VW'—Ğ¢öä6†ævS×²‡fÇVR’Óâ6WE6V&6…VW'’‡fÇVR—Ğ¢ÆÆ÷t6ÆV ¢&Vf—ƒ×³Å6V&6‚6—¦S×´E$õDõtåõ4T$4‚æ–6öå6—¦WÒ7G&ö¶Uv–GFƒ×³ãsWÒóçĞ¢7Vff—ƒ×°¢Å6÷W&6U&Vg&W6…7Vff—€¢F—6&ÆVC×²&WõF‚ÇÂv—F‡V%7FFRÓÓÒ&ÆöF–ær'Ğ¢&Vg&W6†–æs×¶v—F‡V$FFç&Vg&W6†–æwĞ¢&–Æ&VÃ×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Rç&Vg&W6„v—F‡V""Â°¢FVfVÇEfÇVS¢%&Vg&W6‚v—D‡V"Æ—7B"À¢Ò—Ğ¢öä6Æ–6³×²‚’Óâv—F‡V$FFç&Vg&W6‚‚—Ğ¢óà¢Ğ¢Æ6V†öÆFW#×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræv—F‡V%6V&6‚"Â°¢FVfVÇEfÇVS¢%6V&6‚v—D‡V"'2æB—77VW2"À¢Ò—Ğ¢&–ÖÆ&VÃ×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræv—F‡V%6V&6„&–"Â°¢FVfVÇEfÇVS¢%6V&6‚v—D‡V"'2æB—77VW2"À¢Ò—Ğ¢óà ¢Å6÷W&6TÆ—7Cà¢¶v—F‡V%7FFRÓÓÒ&ÆöF–ær"bbv—F‡V$—FV×2æÆVæwF‚ÓÓÒbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"FW‡B×FW‡BÓ2#à¢ÄÆöFW#"6—¦S×³gÒ6Æ74æÖSÒ&æ–ÖFR×7–â"óà¢ÂöF—cà¢—Ğ ¢¶v—F‡V%7FFRÓÓÒ&W'&÷""bb€¢ÆF—`¢&öÆSÒ&ÆW'B ¢&–ÖÆ—fSÒ&76W'F—fR ¢6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"‚ÓBFW‡BÖ6VçFW"FW‡BÕ³7…ÒFW‡B×FW‡BÓ2 ¢à¢¶v—F‡V$W'&÷"ÇÀ¢B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræv—F‡V$W'&÷""Â°¢FVfVÇEfÇVS¢$v—D‡V"—FV×26÷VÆBæ÷B&RÆöFVBâ"À¢Ò—Ğ¢ÂöF—cà¢—Ğ ¢¶v—F‡V%7FFRÓÓÒ&V×G’"bb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"‚ÓBFW‡BÖ6VçFW"FW‡BÕ³7…ÒFW‡B×FW‡BÓ2#à¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræv—F‡V$V×G’"Â°¢FVfVÇEfÇVS¢$æò÷Vâv—D‡V"'2÷"—77VW2â"À¢Ò—Ğ¢ÂöF—cà¢—Ğ ¢¶v—F‡V%7FFRÓÓÒ'&VG’"bbf–ÇFW&VDv—F‡V$—FV×2æÆVæwF‚ÓÓÒbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"‚ÓBFW‡BÖ6VçFW"FW‡BÕ³7…ÒFW‡B×FW‡BÓ2#à¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræv—F‡V$æôÖF6†W2"Â°¢FVfVÇEfÇVS¢$æòÖF6†W2â"À¢Ò—Ğ¢ÂöF—cà¢—Ğ ¢¶v—F‡V%7FFRÓÓÒ'&VG’"bbf–ÇFW&VDv—F‡V$—FV×2æÆVæwF‚âbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚fÆW‚Ö6öÂvÓãR#à¢¶f–ÇFW&VDv—F‡V$—FV×2æÖ‚†—FVÒ’Óâ€¢Å6÷W&6U&÷p¢¶W“×¶—FVÒæ–GĞ¢–6öã×¶—FVÒæ–6öçĞ¢F—FÆS×¶—FVÒç6÷W&6RæÆ&VÇĞ¢6VÆV7FVC×°¢6÷W&6T¶W’†fÆÆ&6µ6÷W&6Róò—FVÒç6÷W&6R’ÓÓĞ¢6÷W&6T¶W’†—FVÒç6÷W&6R¢Ğ¢öä6Æ–6³×²‚’Óâ°¢6WE6VÆV7FVE6÷W&6R†—FVÒç6÷W&6R“°¢6WE&W6öÇfTW'&÷"†çVÆÂ“°¢×Ğ¢óà¢’—Ğ¢ÂöF—cà¢—Ğ¢Âõ6÷W&6TÆ—7Cà¢ÂöF—cà¢“° ¢6öç7B&VæFW$7W7FöÕ&Ve&÷rÒ‚’Óâ°¢–b‚öffW$7W7FöÕ&VbÇÂ7W7FöÕ&Ve6÷W&6R’&WGW&âçVÆÃ°¢&WGW&â€¢Å6÷W&6U&÷p¢–6öã×³Ä†6‚6—¦S×³GÒ7G&ö¶Uv–GFƒ×³ãsWÒóçĞ¢F—FÆS×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6…W6T5&Vb"Â°¢fÇVS¢7W7FöÕ&Ve6÷W&6Ræ&6T'&æ6‚óò""À¢FVfVÇEfÇVS¢W6R"G¶7W7FöÕ&Ve6÷W&6Ræ&6T'&æ6‡Ò"2&VfÀ¢Ò—Ğ¢FWF–Ã×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6„7W7FöÕ&Vd†–çB"Â°¢FVfVÇEfÇVS¢%FrÂ6öÖÖ—BÂ÷"ç’v—B&Vb"À¢Ò—Ğ¢6VÆV7FVC×°¢6÷W&6T¶W’†fÆÆ&6µ6÷W&6Róò7W7FöÕ&Ve6÷W&6R’ÓÓĞ¢6÷W&6T¶W’†7W7FöÕ&Ve6÷W&6R¢Ğ¢öä6Æ–6³×²‚’Óâ6WE6VÆV7FVE6÷W&6R†7W7FöÕ&Ve6÷W&6R—Ğ¢óà¢“°¢Ó° ¢6öç7B&VæFW$'&æ6…F"Ò‚’Óâ€¢ÆF—b6Æ74æÖSÒ&fÆW‚Ö–âÖ‚Õ³#S…ÒfÆW‚Ö6öÂvÓ"#à¢ÆÆ&VÀ¢‡FÖÄf÷#×´%$ä4…õ4T$4…ô”åUEô”GĞ¢6Æ74æÖSÒ'FW‡BÕ³'…ÒföçBÖÖVF—VÒFW‡B×FW‡BÓ2 ¢à¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ&6T'&æ6‚"Â°¢FVfVÇEfÇVS¢$&6R'&æ6‚÷"&Vb"À¢Ò—Ğ¢ÂöÆ&VÃà¢Ä–çW@¢–C×´%$ä4…õ4T$4…ô”åUEô”GĞ¢G—SÒ'6V&6‚ ¢fÇVS×¶'&æ6…VW'—Ğ¢öä6†ævS×²‡fÇVR’Óâ°¢6WD'&æ6…VW'’‡fÇVR“°¢6WE6VÆV7FVE6÷W&6R†çVÆÂ“°¢×Ğ¢ÆÆ÷t6ÆV ¢&Vf—ƒ×³Å6V&6‚6—¦S×´E$õDõtåõ4T$4‚æ–6öå6—¦WÒ7G&ö¶Uv–GFƒ×³ãsWÒóçĞ¢7Vff—ƒ×°¢Å6÷W&6U&Vg&W6…7Vff—€¢F—6&ÆVC×²&WõF‚ÇÂ'&æ6…7FFRÓÓÒ&ÆöF–ær'Ğ¢&Vg&W6†–æs×¶'&æ6„FFç&Vg&W6†–æwĞ¢&–Æ&VÃ×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Rç&Vg&W6„'&æ6†W2"Â°¢FVfVÇEfÇVS¢%&Vg&W6‚'&æ6‚Æ—7B"À¢Ò—Ğ¢öä6Æ–6³×²‚’Óâ'&æ6„FFç&Vg&W6‚‚—Ğ¢óà¢Ğ¢Æ6V†öÆFW#×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6…6V&6‚"Â°¢FVfVÇEfÇVS¢%6V&6‚'&æ6†W2÷"VçFW"&Vb"À¢Ò—Ğ¢&–ÖÆ&VÃ×·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6…6V&6„&–"Â°¢FVfVÇEfÇVS¢%6V&6‚'&æ6†W2÷"VçFW"&6R&Vb"À¢Ò—Ğ¢óà ¢Å6÷W&6TÆ—7Cà¢¶'&æ6…7FFRÓÓÒ&ÆöF–ær"bb'&æ6„÷F–öç2æÆVæwF‚ÓÓÒbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"FW‡B×FW‡BÓ2#à¢ÄÆöFW#"6—¦S×³gÒ6Æ74æÖSÒ&æ–ÖFR×7–â"óà¢ÂöF—cà¢—Ğ ¢¶'&æ6…7FFRÓÓÒ&W'&÷""bb€¢ÆF—`¢&öÆSÒ&ÆW'B ¢&–ÖÆ—fSÒ&76W'F—fR ¢6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…ÒfÆW‚Ö6öÂ—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"vÓ"‚ÓBFW‡BÖ6VçFW"FW‡BÕ³7…ÒFW‡B×FW‡BÓ2 ¢à¢Ç7ãà¢¶'&æ6„W'&÷"ÇÀ¢B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6„W'&÷""Â°¢FVfVÇEfÇVS¢$'&æ6†W26÷VÆBæ÷B&RÆöFVBâ"À¢Ò—Ğ¢Â÷7ãà¢·&VæFW$7W7FöÕ&Ve&÷r‚—Ğ¢ÂöF—cà¢—Ğ ¢¶'&æ6…7FFRÓÓÒ&V×G’"bb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…ÒfÆW‚Ö6öÂ—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"vÓ"‚ÓBFW‡BÖ6VçFW"FW‡BÕ³7…ÒFW‡B×FW‡BÓ2#à¢Ç7ãà¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6„V×G’"Â°¢FVfVÇEfÇVS¢$æò'&æ6†W2f÷VæB–âF†—2&W÷6—F÷'’â"À¢Ò—Ğ¢Â÷7ãà¢·&VæFW$7W7FöÕ&Ve&÷r‚—Ğ¢ÂöF—cà¢—Ğ ¢¶'&æ6…7FFRÓÓÒ'&VG’"b`¢'&æ6„w&÷W2æÆVæwF‚ÓÓÒb`¢öffW$7W7FöÕ&Vbbb€¢ÆF—b6Æ74æÖSÒ&fÆW‚‚Õ³ƒ…Ò—FV×2Ö6VçFW"§W7F–g’Ö6VçFW"‚ÓBFW‡BÖ6VçFW"FW‡BÕ³7…ÒFW‡B×FW‡BÓ2#à¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ'&æ6„æôÖF6†W2"Â°¢FVfVÇEfÇVS¢$æòÖF6†–ær'&æ6†W2â"À¢Ò—Ğ¢ÂöF—cà¢—Ğ ¢¶'&æ6…7FFRÓÓÒ'&VG’"b`¢†'&æ6„w&÷W2æÆVæwF‚âÇÂöffW$7W7FöÕ&Vb’bb€¢ÆF—b6Æ74æÖSÒ&fÆW‚fÆW‚Ö6öÂvÓãR#à¢·&VæFW$7W7FöÕ&Ve&÷r‚—Ğ¢¶'&æ6„w&÷W2æÖ‚†w&÷W’Óâ€¢Å&V7Bäg&vÖVçB¶W“×¶w&÷Wæ¶W—Óà¢ÆF—b6Æ74æÖS×´E$õDõtåô4Ä54U2ç6V7F–öäÆ&VÇÓà¢·B†6öÖÖöã§6VÆV7F÷'2æ'&æ6‚æÆ&VÇ2âG¶w&÷WæÆ&VÄ¶W—ÖÂ°¢FVfVÇEfÇVS¢%$ä4…ôu$õUôÄ$TÅôdÄÄ$4µ¶w&÷WæÆ&VÄ¶W•ÒÀ¢Ò—Ğ¢ÂöF—cà¢¶w&÷Wæ÷F–öç2æÖ‚†÷F–öâ’Óâ°¢6öç7B6÷W&6RÒ'&æ6…FôÆVæ6…6÷W&6R†÷F–öâ“°¢&WGW&â€¢Å6÷W&6U&÷p¢¶W“×¶'&æ6ƒ¢G¶÷F–öâææÖWÖĞ¢–6öã×¶'&æ6…&÷t–6öâ†÷F–öâ—Ğ¢F—FÆS×¶÷F–öâææÖWĞ¢ÖWF×¶f÷&ÖD'&æ6…F–ÖW7F×†÷F–öâ—Ğ¢6VÆV7FVC×°¢6÷W&6T¶W’†fÆÆ&6µ6÷W&6Róò6÷W&6R’ÓÓĞ¢6÷W&6T¶W’‡6÷W&6R¢Ğ¢öä6Æ–6³×²‚’Óâ6WE6VÆV7FVE6÷W&6R‡6÷W&6R—Ğ¢óà¢“°¢Ò—Ğ¢Âõ&V7Bäg&vÖVçCà¢’—Ğ¢ÂöF—cà¢—Ğ¢Âõ6÷W&6TÆ—7Cà¢ÂöF—cà¢“° ¢6öç7B&VæFW$æÖUF"Ò‚’Óâ€¢ÆF—b6Æ74æÖSÒ&fÆW‚Ö–âÖ‚Õ³#S…ÒfÆW‚Ö6öÂvÓ"#à¢ÆÆ&VÀ¢‡FÖÄf÷#×´äÔUô”åUEô”GĞ¢6Æ74æÖSÒ'FW‡BÕ³'…ÒföçBÖÖVF—VÒFW‡B×FW‡BÓ2 ¢à¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Rçv÷&·G&VTÆ&VÂ"Â°¢FVfVÇEfÇVS¢%v÷&·G&VRÆ&VÂ"À¢Ò—Ğ¢ÂöÆ&VÃà¢Ä–çW@¢–C×´äÔUô”åUEô”GĞ¢fÇVS×¶æÖT–çWGĞ¢öä6†ævS×²‡fÇVR’Óâ6WDæÖT–çWB‡fÇVR—Ğ¢&Vf—ƒ×°¢Ä66U6Vç6—F—fR6—¦S×´E$õDõtåô•DTÒæ–6öå6—¦WÒ7G&ö¶Uv–GFƒ×³ãsWÒóà¢Ğ¢Æ6V†öÆFW#×·B‚&7&VF÷"çv÷&·G&VU6÷W&6RææÖUÆ6V†öÆFW""Â°¢FVfVÇEfÇVS¢&fVGW&RÖæÖR"À¢Ò—Ğ¢óà¢¶æÖU6÷W&6Rbb€¢Å6÷W&6TÆ—7Cà¢ÆF—b6Æ74æÖSÒ&fÆW‚fÆW‚Ö6öÂvÓãR#à¢Å6÷W&6U&÷p¢–6öã×³Ä66U6Vç6—F—fR6—¦S×³GÒ7G&ö¶Uv–GFƒ×³ãsWÒóçĞ¢F—FÆS×¶æÖU6÷W&6RçF—FÆRóòæÖU6÷W&6RæÆ&VÇĞ¢FWF–Ã×°¢æÖU6÷W&6Ræ&6T'&æ6€¢ò&6S¢G¶æÖU6÷W&6Ræ&6T'&æ6‡Ö ¢¢$&6S¢„TB ¢Ğ¢6VÆV7FVC×°¢6÷W&6T¶W’†fÆÆ&6µ6÷W&6RóòæÖU6÷W&6R’ÓÓĞ¢6÷W&6T¶W’†æÖU6÷W&6R¢Ğ¢öä6Æ–6³×²‚’Óâ6WE6VÆV7FVE6÷W&6R†æÖU6÷W&6R—Ğ¢óà¢ÂöF—cà¢Âõ6÷W&6TÆ—7Cà¢—Ğ¢ÂöF—cà¢“° ¢&WGW&â€¢ÄÖöFÀ¢f—6–&ÆS×¶÷VçĞ¢öä6Æ÷6S×¶öä6Æ÷6WĞ¢F—FÆS×·B‚&7&VF÷"çv÷&·G&VU6÷W&6RçF—FÆR"Â°¢FVfVÇEfÇVS¢$7&VFRv÷&·G&VR"À¢Ò—Ğ¢v–GFƒ×³ScĞ¢&F—W3×³GĞ¢&öG”6Æ74æÖSÒ'Ó ¢fö÷FW#×°¢ÆF—b6Æ74æÖSÒ&fÆW‚‚ÓB—FV×2Ö6VçFW"§W7F–g’ÖVæBvÓ"&÷&FW"×B&÷&FW"Ö&÷&FW"Ó"‚ÓB#à¢·&W6öÇfTW'&÷"bb€¢Ç7à¢&öÆSÒ&ÆW'B ¢&–ÖÆ—fSÒ&76W'F—fR ¢6Æ74æÖSÒ&×"ÖWFòÖ–â×rÓfÆW‚ÓG'Væ6FRFW‡BÕ³'…ÒFW‡BÖFævW"Ób ¢à¢·&W6öÇfTW'&÷'Ğ¢Â÷7ãà¢—Ğ¢Ä'WGFöà¢f&–çCÒ'6V6öæF'’ ¢6—¦SÒ'6ÖÆÂ ¢öä6Æ–6³×¶öä6Æ÷6WĞ¢F—6&ÆVC×¶—5&W6öÇf–æwĞ¢à¢·B‚&6öÖÖöã¦6æ6VÂ"Â²FVfVÇEfÇVS¢$6æ6VÂ"Ò—Ğ¢Âô'WGFöãà¢Ä'WGFöà¢f&–çCÒ'&–Ö'’ ¢6—¦SÒ'6ÖÆÂ ¢6Æ74æÖSÒ&Ö–â×rÓ3b ¢F—6&ÆVC×²fÆÆ&6µ6÷W&6WĞ¢ÆöF–æs×¶—5&W6öÇf–æwĞ¢&–Ö'W7“×¶—5&W6öÇf–æwĞ¢öä6Æ–6³×²‚’Óâ°¢fö–B†æFÆT6öæf—&Ò‚“°¢×Ğ¢à¢·B‚&7&VF÷"çv÷&·G&VU6÷W&6Ræ6öæf—&Ò"Â°¢FVfVÇEfÇVS¢%W6Rv÷&·G&VR"À¢Ò—Ğ¢Âô'WGFöãà¢ÂöF—cà¢Ğ¢à¢ÆF—b6Æ74æÖSÒ&fÆW‚fÆW‚Ö6öÂvÓ2ÓB#à¢ÆF—`¢&öÆSÒ'F&Æ—7B ¢6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓ&÷&FW"Ö"&÷&FW"Ö&÷&FW"Ó" ¢à¢·F'2æÖ‚‡F"’Óâ€¢Æ'WGFöà¢¶W“×·F"æ–GĞ¢G—SÒ&'WGFöâ ¢&öÆSÒ'F" ¢–C×¶v÷&·G&VR×6÷W&6R×F"ÒG·F"æ–GÖĞ¢&–×6VÆV7FVC×¶7F—fUF"ÓÓÒF"æ–GĞ¢&–Ö6öçG&öÇ3×¶v÷&·G&VR×6÷W&6R×F'æVÂÒG·F"æ–GÖĞ¢öä6Æ–6³×²‚’Óâ°¢6WD7F—fUF"‡F"æ–B“°¢6WE6VÆV7FVE6÷W&6R†çVÆÂ“°¢6WE&W6öÇfTW'&÷"†çVÆÂ“°¢×Ğ¢6Æ74æÖS×¶fÆW‚‚Ó’—FV×2Ö6VçFW"vÓãR&÷&FW"Ö"Ó"‚Ó"FW‡BÕ³7…ÒföçBÖÖVF—VÒG&ç6—F–öâÖ6öÆ÷'2G°¢7F—fUF"ÓÓÒF"æ–@¢ò&&÷&FW"×FW‡BÓFW‡B×FW‡BÓ ¢¢&&÷&FW"×G&ç7&VçBFW‡B×FW‡BÓ2†÷fW#§FW‡B×FW‡BÓ ¢ÖĞ¢à¢·F"æ–6öçĞ¢Ç7ãç·F"æÆ&VÇÓÂ÷7ãà¢Âö'WGFöãà¢’—Ğ¢ÂöF—cà ¢ÆF—`¢&öÆSÒ'F'æVÂ ¢–C×¶v÷&·G&VR×6÷W&6R×F'æVÂÒG¶7F—fUF'ÖĞ¢&–ÖÆ&VÆÆVF'“×¶v÷&·G&VR×6÷W&6R×F"ÒG¶7F—fUF'ÖĞ¢6Æ74æÖSÒ&Ö–âÖ‚Õ³#S…Ò ¢à¢¶7F—fUF"ÓÓÒ'6Ö'B"bb&VæFW%6Ö'EF"‚—Ğ¢¶7F—fUF"ÓÓÒ&v—F‡V""bb&VæFW$v—F‡V%F"‚—Ğ¢¶7F—fUF"ÓÓÒ&'&æ6‚"bb&VæFW$'&æ6…F"‚—Ğ¢¶7F—fUF"ÓÓÒ&æÖR"bb&VæFW$æÖUF"‚—Ğ¢ÂöF—cà¢ÂöF—cà¢ÂôÖöFÃà¢“°§Ó° ¦W‡÷'BFVfVÇBv÷&·G&VU6÷W&6TÖöFÃ°
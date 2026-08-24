/**
 * Tab-type → renderer registry.
 *
 * Each entry holds a `load` factory that dynamically imports a tiny wrapper
 * file in `./renderers/`. The wrapper is responsible for adapting `tab.data`
 * into the underlying view component's prop shape. The dispatcher
 * (`UnifiedTabContent.tsx`) is the only consumer of this map.
 *
 * Entries store the *factory* rather than a prebuilt `React.lazy` component so
 * a failed chunk can be retried: `React.lazy` caches its rejection forever, so
 * recovery requires building a fresh lazy component from the same factory. See
 * `./rendererComponents.ts`, which owns that cache.
 *
 * Phase 1b: this registry is exhaustive over `WorkStationTabType` but
 * is not yet wired into AppShell. The exhaustiveness check at the
 * bottom guarantees every union member gets an entry.
 */
import type { WorkStationTabType } from "@src/store/workstation/tabs/types";

import type { RendererEntry, TabContentRegistry } from "./types";

// ============================================
// Editor-family renderers
// ============================================

const FileEntry: RendererEntry = {
  load: () => import("./renderers/file"),
  requiresRepo: true,
  debugLabel: "file",
};

const ExplorerEntry: RendererEntry = {
  load: () => import("./renderers/explorer"),
  debugLabel: "explorer",
};

const DirectoryEntry: RendererEntry = {
  load: () => import("./renderers/directory"),
  requiresRepo: true,
  debugLabel: "directory",
};

const GitDiffEntry: RendererEntry = {
  load: () => import("./renderers/gitDiff"),
  requiresRepo: true,
  debugLabel: "git-diff",
};

const SourceControlEntry: RendererEntry = {
  load: () => import("./renderers/sourceControl"),
  requiresRepo: true,
  debugLabel: "source-control",
};

const TimelineDiffEntry: RendererEntry = {
  load: () => import("./renderers/timelineDiff"),
  requiresRepo: true,
  debugLabel: "timeline-diff",
};

const GitLogEntry: RendererEntry = {
  load: () => import("./renderers/gitLog"),
  requiresRepo: true,
  debugLabel: "git-log",
};

const GitCommitDetailEntry: RendererEntry = {
  load: () => import("./renderers/gitCommitDetail"),
  requiresRepo: true,
  debugLabel: "git-commit-detail",
};

const GitStashDetailEntry: RendererEntry = {
  load: () => import("./renderers/gitStashDetail"),
  requiresRepo: true,
  debugLabel: "git-stash-detail",
};

const TerminalContentEntry: RendererEntry = {
  load: () => import("./renderers/terminalContent"),
  debugLabel: "terminal-content",
};

const DomComponentPreviewEntry: RendererEntry = {
  load: () => import("./renderers/domComponentPreview"),
  debugLabel: "dom-component-preview",
};

const TerminalEntry: RendererEntry = {
  load: () => import("./renderers/terminal"),
  debugLabel: "terminal",
};

const OutputEntry: RendererEntry = {
  load: () => import("./renderers/output"),
  debugLabel: "output",
};

const SettingsEntry: RendererEntry = {
  load: () => import("./renderers/settings"),
  debugLabel: "settings",
};

const SearchEntry: RendererEntry = {
  load: () => import("./renderers/search"),
  requiresRepo: true,
  debugLabel: "search",
};

const LintScanEntry: RendererEntry = {
  load: () => import("./renderers/lintScan"),
  requiresRepo: true,
  debugLabel: "lint-scan",
};

const AIImpactEntry: RendererEntry = {
  load: () => import("./renderers/aiImpact"),
  debugLabel: "ai-impact",
};

const SearchSessionsEntry: RendererEntry = {
  load: () => import("./renderers/searchSessions"),
  debugLabel: "search-sessions",
};

const UrlPreviewEntry: RendererEntry = {
  load: () => import("./renderers/urlPreview"),
  debugLabel: "url-preview",
};

const SubagentDetailEntry: RendererEntry = {
  load: () => import("./renderers/subagentDetail"),
  debugLabel: "subagent-detail",
};

const AgentConfigEntry: RendererEntry = {
  load: () => import("./renderers/agentConfig"),
  debugLabel: "agent-config",
};

const ChatSessionEntry: RendererEntry = {
  load: () => import("./renderers/chatSession"),
  debugLabel: "chat-session",
};

// ============================================
// Browser renderers
// ============================================

const BrowserSessionEntry: RendererEntry = {
  load: () => import("./renderers/browserSession"),
  debugLabel: "browser-session",
};

const DevtoolsEntry: RendererEntry = {
  load: () => import("./renderers/devtools"),
  debugLabel: "devtools",
};

// ============================================
// Project Manager renderers
// ============================================

const ProjectDashboardEntry: RendererEntry = {
  load: () => import("./renderers/projectDashboard"),
  debugLabel: "project-dashboard",
};

const ProjectWorkItemsEntry: RendererEntry = {
  load: () => import("./renderers/projectWorkItems"),
  debugLabel: "project-work-items",
};

const ProjectWorkitemsEntry: RendererEntry = {
  load: () => import("./renderers/projectWorkitemsCompat"),
  debugLabel: "project-workitems",
};

const ProjectLinearProjectsEntry: RendererEntry = {
  load: () => import("./renderers/projectLinearProjects"),
  debugLabel: "project-linear-projects",
};

const ProjectLinearWorkItemsEntry: RendererEntry = {
  load: () => import("./renderers/projectLinearWorkItems"),
  debugLabel: "project-linear-work-items",
};

const ProjectSettingsEntry: RendererEntry = {
  load: () => import("./renderers/projectSettings"),
  debugLabel: "project-settings",
};

const ProjectOrgEntry: RendererEntry = {
  load: () => import("./renderers/projectOrg"),
  debugLabel: "project-org",
};

const ProjectOrgSettingsEntry: RendererEntry = {
  load: () => import("./renderers/projectOrgSettings"),
  debugLabel: "project-org-settings",
};

const ProjectGitSyncReviewEntry: RendererEntry = {
  load: () => import("./renderers/projectGitSyncReview"),
  debugLabel: "project-git-sync-review",
};

const WorkItemDetailEntry: RendererEntry = {
  load: () => import("./renderers/workItemDetail"),
  debugLabel: "workItem-detail",
};

// ============================================
// Canvas Preview renderer
// ============================================

const CanvasPreviewEntry: RendererEntry = {
  load: () => import("./renderers/canvasPreview"),
  debugLabel: "canvas-preview",
};

// ============================================
// GitHub Issue Detail renderer
// ============================================

const GitHubIssueDetailEntry: RendererEntry = {
  load: () => import("./renderers/githubIssueDetail"),
  debugLabel: "github-issue-detail",
};

const GitHubPrDetailEntry: RendererEntry = {
  load: () => import("./renderers/githubPrDetail"),
  debugLabel: "github-pr-detail",
};

const StartEntry: RendererEntry = {
  load: () => import("./renderers/start"),
  debugLabel: "start",
};

// ============================================
// Registry — exhaustive over WorkStationTabType
// ============================================

export const REGISTRY: TabContentRegistry = {
  // Code Editor
  file: FileEntry,
  directory: DirectoryEntry,
  explorer: ExplorerEntry,
  "git-diff": GitDiffEntry,
  "source-control": SourceControlEntry,
  "timeline-diff": TimelineDiffEntry,
  "git-log": GitLogEntry,
  "git-commit-detail": GitCommitDetailEntry,
  "git-stash-detail": GitStashDetailEntry,
  "terminal-content": TerminalContentEntry,
  "dom-component-preview": DomComponentPreviewEntry,
  terminal: TerminalEntry,
  output: OutputEntry,
  settings: SettingsEntry,
  search: SearchEntry,
  "lint-scan": LintScanEntry,
  "ai-impact": AIImpactEntry,
  "search-sessions": SearchSessionsEntry,
  "url-preview": UrlPreviewEntry,

  // Browser
  "browser-session": BrowserSessionEntry,
  devtools: DevtoolsEntry,

  // Project Manager
  "project-dashboard": ProjectDashboardEntry,
  "project-work-items": ProjectWorkItemsEntry,
  "project-linear-projects": ProjectLinearProjectsEntry,
  "project-linear-work-items": ProjectLinearWorkItemsEntry,
  "project-settings": ProjectSettingsEntry,
  "project-org": ProjectOrgEntry,
  "project-org-settings": ProjectOrgSettingsEntry,
  "project-git-sync-review": ProjectGitSyncReviewEntry,
  "project-workitems": ProjectWorkitemsEntry,
  "workItem-detail": WorkItemDetailEntry,
  "chat-session": ChatSessionEntry,

  // Subagent
  "subagent-detail": SubagentDetailEntry,

  // Agent Config (Agent Teams page → opens here)
  "agent-config": AgentConfigEntry,

  // Canvas Preview
  "canvas-preview": CanvasPreviewEntry,

  // GitHub Issue Detail
  "github-issue-detail": GitHubIssueDetailEntry,

  // GitHub PR Detail
  "github-pr-detail": GitHubPrDetailEntry,

  // Start page launcher
  start: StartEntry,
};

// Exhaustiveness check: any missing WorkStationTabType becomes a TS error.
const _exhaustive: Record<WorkStationTabType, RendererEntry> = REGISTRY;
void _exhaustive;

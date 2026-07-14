/**
 * Code Editor host context — Phase 2.4 of the WorkStation unified-tab migration.
 *
 * Publishes the Code Editor host's live state + action surface ABOVE the tab
 * dispatcher so that `UnifiedTabContent` renderers for editor tab types
 * (`TabContent/renderers/{file,gitDiff,gitCommitDetail,…}.tsx`) can consume it
 * directly, instead of receiving it as the 14-field prop bag threaded through
 * `TabContentRenderer`. This is the "host context hoist" the staged editor
 * renderers wait on before they can drop their `HostCoupledPlaceholder` stubs.
 *
 * The value is EXACTLY the subset of `TabContentRendererProps` the per-tab
 * renderers consume (everything except `activeTab` — a renderer only handles
 * its own tab, passed via `UnifiedTabContentProps` — and the Source Control
 * overlay / placeholder props that stay owned by `EditorMainPane`). Sourcing it
 * from `TabContentRendererProps` via `Pick` keeps the two in lockstep by
 * construction.
 *
 * CRITICAL — live-state instances:
 *   - `fileContentState` is the LIVE file-content manager (`useFileContentManager`
 *     in `EditorMainPane`); recreating it per-tab breaks editing/dirty-diff.
 *   - `terminalState` is the LIVE PTY runtime (`useTerminalState`, owned above
 *     `EditorMainPane`); recreating it per-tab breaks running terminals.
 * The provider MUST be mounted with the SAME instances the editor host already
 * holds — see `EditorMainPane/index.tsx`.
 *
 * See docs/workstation-unification/phase-2-host-hoist-plan.md (Phase 2.4).
 */
import { type ReactNode, createContext, useContext } from "react";

import type { TabContentRendererProps } from "../content/TabContentRenderer/types";

/**
 * The live host state + callbacks published to editor tab renderers. Exactly
 * the 14 fields `TabContentRenderer` threads from `EditorMainPane` (minus the
 * per-tab `activeTab` and the Source Control overlay / placeholder props).
 */
export type EditorHostContextValue = Pick<
  TabContentRendererProps,
  | "fileContentState"
  | "gitFilesByPath"
  | "gitDiffLoading"
  | "forceRefresh"
  | "onFileSelect"
  | "onFileSelectWithLine"
  | "onDiagnosticsChange"
  | "onCursorPositionChange"
  | "onSearchTabTitleChange"
  | "onGitDiffUnsavedChange"
  | "onBinaryUnsavedChange"
  | "terminalState"
  | "repoPath"
  | "repoId"
>;

const EditorHostContext = createContext<EditorHostContextValue | null>(null);

export function EditorHostProvider({
  value,
  children,
}: {
  value: EditorHostContextValue;
  children: ReactNode;
}) {
  return (
    <EditorHostContext.Provider value={value}>
      {children}
    </EditorHostContext.Provider>
  );
}

/**
 * Read the Code Editor host context. Throws if used outside an
 * `EditorHostProvider` — this guards against mounting an editor renderer
 * through the unified dispatcher before the host context has been hoisted above
 * it (which would otherwise silently render a degraded surface without the live
 * file-content manager / PTY runtime).
 */
export function useEditorHostContext(): EditorHostContextValue {
  const ctx = useContext(EditorHostContext);
  if (ctx === null) {
    throw new Error(
      "useEditorHostContext must be used within an EditorHostProvider"
    );
  }
  return ctx;
}

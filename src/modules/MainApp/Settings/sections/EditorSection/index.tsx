/**
 * Editor & Workspace Settings Section
 *
 * One tab: `editor` (terminal, language servers, workspace default path).
 */
import React from "react";

import TerminalSection from "./components/TerminalSettingsSection";
import WorkspaceDefaultPathSection from "./components/WorkspaceDefaultPathSection";

export const EDITOR_TAB_KEYS = {
  EDITOR: "editor",
} as const;

export type EditorTabKey =
  (typeof EDITOR_TAB_KEYS)[keyof typeof EDITOR_TAB_KEYS];

const EditorSection: React.FC = () => (
  <>
    <WorkspaceDefaultPathSection />
    <TerminalSection />
  </>
);

export default EditorSection;

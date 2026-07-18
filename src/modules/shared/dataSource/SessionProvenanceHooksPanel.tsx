/**
 * The Hooks view of the Data Sources panel. Managed capture settings and recent
 * provenance signals remain independent so each table owns its async state.
 */
import React from "react";

import HookPlatformsTable from "./SessionProvenanceHookPlatformsTable";
import RecentSignalsTable from "./SessionProvenanceRecentSignalsTable";

const SessionProvenanceHooksPanel: React.FC = () => {
  return (
    <div
      className="flex flex-col gap-4"
      data-testid="session-provenance-hooks-panel"
    >
      <HookPlatformsTable />
      <RecentSignalsTable />
    </div>
  );
};

export default SessionProvenanceHooksPanel;

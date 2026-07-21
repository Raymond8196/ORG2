import React from "react";

import DataSourcePanel from "@src/modules/shared/dataSource";

import { StartPageQuotaGrid } from "../StartPageQuotaGrid";
import WorkspaceDashboardPanelView from "./WorkspaceDashboardPanelView";

/** First-class Runtime surface: local sources, capture hooks, usage, and assets. */
export default function RuntimePanelView(): React.ReactElement {
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <DataSourcePanel
        usageHeaderContent={<StartPageQuotaGrid />}
        assetsContent={<WorkspaceDashboardPanelView />}
      />
    </div>
  );
}

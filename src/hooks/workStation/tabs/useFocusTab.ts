import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { DEFAULT_DOCK_FILTER, dockFilterAtom } from "@src/store/workstation";
import {
  type TabFocusRequest,
  focusTabAtom,
} from "@src/store/workstation/tabRegistry";

/**
 * Focus a tab inside the unified workstation pane registry.
 *
 * Phase 1a removed the host-based route navigation that used to live here:
 * the unified pane tree owns focus, and the AppShell's `appMode` follows
 * the pane through other means (status bar / pane id derivation). Phase 2
 * will collapse the AppShell entirely, at which point even that
 * derivation goes away.
 */
export function useFocusTab(): (request: TabFocusRequest) => void {
  const setStationMode = useSetAtom(stationModeAtom);
  const focusTab = useSetAtom(focusTabAtom);
  const setDockFilter = useSetAtom(dockFilterAtom);

  return useCallback(
    (request: TabFocusRequest) => {
      setStationMode("my-station");
      // Focusing a unified-strip tab is an explicit "show this tab" intent,
      // so release any Browser-host pin (`dockFilter === "browser"`) and let
      // the content host follow the tab we just focused.
      setDockFilter(DEFAULT_DOCK_FILTER);
      focusTab(request);
    },
    [setStationMode, setDockFilter, focusTab]
  );
}

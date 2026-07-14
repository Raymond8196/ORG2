import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import {
  type StatusBarAppType,
  activeStatusBarAppAtom,
} from "@src/store/ui/workStationAtom";
import { type DockFilter, activeHostAtom } from "@src/store/workstation";

import { useActiveTabHostReconciliation } from "./useActiveTabHostReconciliation";

export interface AppShellDerivedState {
  effectiveHost: string;
  isCodeMode: boolean;
  isBrowserMode: boolean;
  isProjectMode: boolean;
  codeContentVisible: boolean;
  browserContentVisible: boolean;
  projectContentVisible: boolean;
}

function isWorkStationHost(host: string): host is Exclude<DockFilter, "all"> {
  return host === "code" || host === "browser" || host === "project";
}

export function useAppShellDerivedState({
  dockFilter,
}: {
  dockFilter: DockFilter;
}): AppShellDerivedState {
  const activeHost = useAtomValue(activeHostAtom);
  // Unified surface: the content host follows the active tab's host so that
  // opening any tab (Explorer, Source Control, Terminal, Work Items, Projects)
  // swaps the visible surface without route navigation. The Browser host is
  // the one exception — its sessions still live in a separate store
  // (`browserTabsAtom`), so no browser tab ever becomes the active `mainPane`
  // tab. We keep it reachable through the explicit `dockFilter === "browser"`
  // pin (set by the `+`/start-page "New Browser Tab" actions and released when
  // the user focuses any `mainPane` tab — see `useFocusTab`).
  const effectiveHost = dockFilter === "browser" ? "browser" : activeHost;

  useActiveTabHostReconciliation(
    isWorkStationHost(effectiveHost) ? effectiveHost : null
  );

  const isCodeMode = effectiveHost === "code";
  const isBrowserMode = effectiveHost === "browser";
  const isProjectMode = effectiveHost === "project";

  const codeContentVisible = isCodeMode;
  const browserContentVisible = isBrowserMode;
  const projectContentVisible = isProjectMode;

  const setActiveStatusBarApp = useSetAtom(activeStatusBarAppAtom);
  useEffect(() => {
    let appType: StatusBarAppType;
    if (effectiveHost === "browser") {
      appType = "browser";
    } else if (effectiveHost === "project") {
      appType = "project";
    } else {
      appType = "code";
    }
    setActiveStatusBarApp(appType);
  }, [effectiveHost, setActiveStatusBarApp]);

  return {
    effectiveHost,
    isCodeMode,
    isBrowserMode,
    isProjectMode,
    codeContentVisible,
    browserContentVisible,
    projectContentVisible,
  };
}

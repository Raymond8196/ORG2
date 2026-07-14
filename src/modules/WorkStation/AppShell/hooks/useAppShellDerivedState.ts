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
  const effectiveHost = dockFilter === "all" ? activeHost : dockFilter;

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

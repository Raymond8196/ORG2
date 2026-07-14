import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import {
  type StatusBarAppType,
  activeStatusBarAppAtom,
} from "@src/store/ui/workStationAtom";
import { activeHostAtom } from "@src/store/workstation";

export interface AppShellDerivedState {
  effectiveHost: string;
  isCodeMode: boolean;
  isBrowserMode: boolean;
  isProjectMode: boolean;
  codeContentVisible: boolean;
  browserContentVisible: boolean;
  projectContentVisible: boolean;
}

export function useAppShellDerivedState(): AppShellDerivedState {
  // Unified surface: the content host simply follows the active tab's host.
  // Browser sessions live in `mainPane` (as `browser-session` tabs), so a
  // browser tab makes `activeHost` "browser" on its own — no host pin needed,
  // and closing the last tab lands back on the Launchpad instead of a
  // stranded empty host.
  const effectiveHost = useAtomValue(activeHostAtom);

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

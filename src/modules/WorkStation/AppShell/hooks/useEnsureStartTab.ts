/**
 * useEnsureStartTab
 *
 * Opens the `start` launcher tab once, on WorkStation mount, when the tab pool
 * is empty (fresh launch, or a reload after the user closed everything). The
 * start tab is a regular closable tab; if the user closes it and the pool goes
 * empty again, `AppShellContent` still shows the start page as the empty-pool
 * fallback, so we don't re-seed it reactively.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import {
  createStartTab,
  mainPaneTabsAtom,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

export function useEnsureStartTab(enabled: boolean): void {
  const tabCount = useAtomValue(mainPaneTabsAtom).length;
  const setLayout = useSetAtom(workstationLayoutAtom);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!enabled || seededRef.current || tabCount > 0) return;
    seededRef.current = true;
    setLayout((prev) => {
      if (!prev?.mainPane || prev.mainPane.tabs.length > 0) return prev;
      return { ...prev, mainPane: openTab(prev.mainPane, createStartTab()) };
    });
  }, [enabled, tabCount, setLayout]);
}

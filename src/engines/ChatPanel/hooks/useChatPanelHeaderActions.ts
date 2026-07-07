import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef, useState } from "react";

import {
  eventCountAtom,
  eventsAtom,
} from "@src/engines/SessionCore/core/atoms";
import { useDropdownEngine } from "@src/hooks/dropdown";
import {
  chatHistoryDisplayModeAtom,
  chatPanelExploreAgentSearchEnabledAtom,
  chatTokenUsageVisibleAtom,
  chatTurnPaginationEnabledAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  collapseAllCommandAtom,
  setAllBlocksCollapsedAtom,
} from "@src/store/ui/collapseStateAtom";

interface UseChatPanelHeaderActionsOptions {
  handleReloadSession: () => void;
}

export function useChatPanelHeaderActions({
  handleReloadSession,
}: UseChatPanelHeaderActionsOptions) {
  const openSearchRef = useRef<(() => void) | null>(null);
  const {
    isOpen: isHeaderActionsOpen,
    isPositioned: isHeaderActionsPositioned,
    toggle: toggleHeaderActionsMenu,
    close: closeHeaderActionsMenu,
    triggerRef: headerActionsTriggerRef,
    panelRef: headerActionsDropdownRef,
    panelPosition: headerActionsPosition,
  } = useDropdownEngine<HTMLButtonElement>({
    gap: 4,
    align: "right",
    placement: "bottom",
  });

  const [paginationEnabled, setPaginationEnabled] = useAtom(
    chatTurnPaginationEnabledAtom
  );
  const [displayMode, setDisplayMode] = useAtom(chatHistoryDisplayModeAtom);
  const [tokenUsageVisible, setTokenUsageVisible] = useAtom(
    chatTokenUsageVisibleAtom
  );
  const [exploreAgentSearchEnabled, setExploreAgentSearchEnabled] = useAtom(
    chatPanelExploreAgentSearchEnabledAtom
  );
  const collapseAllCommand = useAtomValue(collapseAllCommandAtom);
  const setAllBlocksCollapsed = useSetAtom(setAllBlocksCollapsedAtom);
  const eventCount = useAtomValue(eventCountAtom);
  const events = useAtomValue(eventsAtom);
  const [copyEventJsonLabel, setCopyEventJsonLabel] = useState<
    "idle" | "copied" | "failed"
  >("idle");

  const allBlocksCollapsed =
    collapseAllCommand.epoch > 0 ? collapseAllCommand.collapsed : false;

  const handleToggleAllBlocksCollapsed = useCallback(() => {
    setAllBlocksCollapsed(!allBlocksCollapsed);
    closeHeaderActionsMenu();
  }, [allBlocksCollapsed, closeHeaderActionsMenu, setAllBlocksCollapsed]);

  const handleRegisterSearchOpen = useCallback(
    (handler: (() => void) | null) => {
      openSearchRef.current = handler;
    },
    []
  );

  const handleOpenSearch = useCallback(() => {
    openSearchRef.current?.();
    closeHeaderActionsMenu();
  }, [closeHeaderActionsMenu]);

  const handleReloadFromMenu = useCallback(() => {
    handleReloadSession();
    closeHeaderActionsMenu();
  }, [closeHeaderActionsMenu, handleReloadSession]);

  const handlePaginationToggle = useCallback(
    (checked: boolean) => {
      setPaginationEnabled(checked);
    },
    [setPaginationEnabled]
  );

  const handleExploreAgentSearchToggle = useCallback(
    (checked: boolean) => {
      setExploreAgentSearchEnabled(checked);
    },
    [setExploreAgentSearchEnabled]
  );

  const handleCompactDisplayModeToggle = useCallback(
    (checked: boolean) => {
      setDisplayMode(checked ? "compact" : "full");
    },
    [setDisplayMode]
  );

  const handleTokenUsageVisibleToggle = useCallback(
    (checked: boolean) => {
      setTokenUsageVisible(checked);
    },
    [setTokenUsageVisible]
  );

  const handleCopyEventJson = useCallback(() => {
    const json = JSON.stringify(events, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => {
        setCopyEventJsonLabel("copied");
        setTimeout(() => setCopyEventJsonLabel("idle"), 2000);
      })
      .catch(() => {
        setCopyEventJsonLabel("failed");
        setTimeout(() => setCopyEventJsonLabel("idle"), 2000);
      });
    closeHeaderActionsMenu();
  }, [closeHeaderActionsMenu, events]);

  return {
    allBlocksCollapsed,
    closeHeaderActionsMenu,
    copyEventJsonLabel,
    displayMode,
    eventCount,
    exploreAgentSearchEnabled,
    handleCompactDisplayModeToggle,
    handleCopyEventJson,
    handleExploreAgentSearchToggle,
    handleOpenSearch,
    handlePaginationToggle,
    handleRegisterSearchOpen,
    handleReloadFromMenu,
    handleToggleAllBlocksCollapsed,
    handleTokenUsageVisibleToggle,
    headerActionsDropdownRef,
    headerActionsPosition,
    headerActionsTriggerRef,
    isHeaderActionsOpen,
    isHeaderActionsPositioned,
    paginationEnabled,
    tokenUsageVisible,
    toggleHeaderActionsMenu,
  };
}

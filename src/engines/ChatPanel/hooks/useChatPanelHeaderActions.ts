import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import { chatPanelExploreAgentSearchEnabledAtom } from "@src/store/ui/chatPanelAtom";
import {
  collapseAllCommandAtom,
  setAllBlocksCollapsedAtom,
} from "@src/store/ui/collapseStateAtom";

import { useSessionHeaderActions } from "./useSessionHeaderActions";

interface UseChatPanelHeaderActionsOptions {
  handleReloadSession: () => void;
}

export function useChatPanelHeaderActions({
  handleReloadSession,
}: UseChatPanelHeaderActionsOptions) {
  const sessionActions = useSessionHeaderActions({ handleReloadSession });
  const { closeHeaderActionsMenu } = sessionActions;
  const [exploreAgentSearchEnabled, setExploreAgentSearchEnabled] = useAtom(
    chatPanelExploreAgentSearchEnabledAtom
  );
  const collapseAllCommand = useAtomValue(collapseAllCommandAtom);
  const setAllBlocksCollapsed = useSetAtom(setAllBlocksCollapsedAtom);
  const allBlocksCollapsed =
    collapseAllCommand.epoch > 0 ? collapseAllCommand.collapsed : false;

  const handleToggleAllBlocksCollapsed = useCallback(() => {
    setAllBlocksCollapsed(!allBlocksCollapsed);
    closeHeaderActionsMenu();
  }, [allBlocksCollapsed, closeHeaderActionsMenu, setAllBlocksCollapsed]);

  const handleExploreAgentSearchToggle = useCallback(
    (checked: boolean) => {
      setExploreAgentSearchEnabled(checked);
    },
    [setExploreAgentSearchEnabled]
  );

  return {
    ...sessionActions,
    allBlocksCollapsed,
    exploreAgentSearchEnabled,
    handleExploreAgentSearchToggle,
    handleToggleAllBlocksCollapsed,
  };
}

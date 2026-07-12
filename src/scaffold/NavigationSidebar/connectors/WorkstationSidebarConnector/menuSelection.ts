import type { ChatPanelTabType } from "@src/store/chatPanel/chatPanelTabsAtom";
import type { SessionCreatorDraft } from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
} from "@src/store/ui/chatPanelAtom";

import {
  COLLAB_ADD_ORG_MENU_ITEM_ID,
  OPS_CONTROL_KANBAN_MENU_ITEM_ID,
} from "../sidebarConnectorUtils";
import {
  getSelectedDraftMenuItemId,
  getSelectedMenuItemId,
  getSelectedPinnedMenuItemId,
} from "../workstationSidebarData";
import type { WorkstationSidebarKey } from "./types";

interface ResolveSelectedMenuItemIdParams {
  activeSessionCreatorDraftId: string | null | undefined;
  activeSessionId: string;
  activeSidebarKey: WorkstationSidebarKey;
  activeChatPanelTabType: ChatPanelTabType | null;
  chatPanelContentMode: ChatPanelContentMode;
  chatPanelCreateTarget: ChatPanelCreateTarget;
  chatPanelSelectedProject: ChatPanelSelectedProject | null;
  chatPanelSelectedWorkItem: ChatPanelSelectedWorkItem | null;
  opsControlRoutePath: string;
  pathname: string;
  projectsSelectedMenuItemId: string;
  sessionCreatorDrafts: readonly SessionCreatorDraft[];
}

interface ResolvedSelectedMenuItemIds {
  selectedMenuItemId: string;
  sessionSelectedMenuItemId: string;
}

export function resolveSelectedMenuItemIds({
  activeSessionCreatorDraftId,
  activeSessionId,
  activeSidebarKey,
  activeChatPanelTabType,
  chatPanelContentMode,
  chatPanelCreateTarget,
  chatPanelSelectedProject,
  chatPanelSelectedWorkItem,
  opsControlRoutePath,
  pathname,
  projectsSelectedMenuItemId,
  sessionCreatorDrafts,
}: ResolveSelectedMenuItemIdParams): ResolvedSelectedMenuItemIds {
  const selectedDraftMenuItemId = getSelectedDraftMenuItemId(
    activeSessionCreatorDraftId ?? null,
    sessionCreatorDrafts
  );
  const selectedPinnedMenuItemId =
    activeChatPanelTabType === "ops-control"
      ? OPS_CONTROL_KANBAN_MENU_ITEM_ID
      : getSelectedPinnedMenuItemId(pathname, opsControlRoutePath);
  const isChatPanelProjectsContentSelected =
    chatPanelContentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION ||
    Boolean(chatPanelSelectedWorkItem) ||
    Boolean(chatPanelSelectedProject);
  const sessionSelectedMenuItemId =
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.PROJECT ||
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM ||
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.COLLAB_ORG ||
    isChatPanelProjectsContentSelected
      ? ""
      : getSelectedMenuItemId({
          selectedPinnedMenuItemId,
          activeSessionId,
          selectedDraftMenuItemId,
        });
  const resolvedProjectsSelectedMenuItemId =
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.COLLAB_ORG
      ? COLLAB_ADD_ORG_MENU_ITEM_ID
      : chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.PROJECT ||
          chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM ||
          chatPanelSelectedWorkItem ||
          chatPanelSelectedProject
        ? projectsSelectedMenuItemId
        : "";
  const selectedMenuItemId =
    activeSidebarKey === "projects"
      ? resolvedProjectsSelectedMenuItemId || projectsSelectedMenuItemId
      : sessionSelectedMenuItemId;

  return { selectedMenuItemId, sessionSelectedMenuItemId };
}

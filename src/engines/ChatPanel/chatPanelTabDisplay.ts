import { SESSION_CONFIG } from "@src/config/sessionCreatorConfig";
import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsAtom";
import type { Session } from "@src/store/session";
import { stripPillReferences } from "@src/util/session/stripPillReferences";

export interface ChatPanelTabDisplayLabels {
  launchpad: string;
  opsControl: string;
  sessionFallback: string;
}

/** Resolve a pill label only from that tab's identity and linked entity. */
export function resolveChatPanelTabDisplayTitle(
  tab: ChatPanelTab,
  session: Session | null | undefined,
  labels: ChatPanelTabDisplayLabels
): string {
  switch (tab.type) {
    case "start-page":
      return labels.launchpad;
    case "ops-control":
      return labels.opsControl;
    case "session": {
      const sessionName =
        session?.name && session.name !== SESSION_CONFIG.DEFAULT_SESSION_NAME
          ? session.name
          : undefined;
      return (
        sessionName ||
        stripPillReferences(session?.user_input || "") ||
        (tab.title === "Launchpad" ? labels.sessionFallback : tab.title)
      );
    }
    case "terminal":
      return tab.title;
  }
}

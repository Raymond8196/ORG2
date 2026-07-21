import { atom } from "jotai";
import type { ReactNode } from "react";

export interface ChatPanelHeaderSlots {
  trailing?: ReactNode;
}

export type ChatPanelHeaderContribution = ChatPanelHeaderSlots | null;

export const chatPanelHeaderSlotsAtom = atom<ChatPanelHeaderSlots | null>(null);
chatPanelHeaderSlotsAtom.debugLabel = "chatPanelHeaderSlotsAtom";

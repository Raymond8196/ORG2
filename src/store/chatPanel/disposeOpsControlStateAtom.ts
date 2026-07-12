import { atom } from "jotai";

import {
  kanbanReplayBoundsAtom,
  kanbanReplayCursorAtom,
  kanbanReplayEventsAtom,
  kanbanReplayModeAtom,
  kanbanReplayPlayingAtom,
  kanbanReplaySpeedAtom,
} from "@src/store/ui/kanbanReplayAtom";
import {
  kanbanDetailPanelVisibleAtom,
  kanbanSelectedTaskIdAtom,
} from "@src/store/ui/kanbanViewStateAtom";
import { opsControlCreatorVisibleAtom } from "@src/store/ui/opsControlCreatorAtom";
import {
  OPS_CONTROL_PROJECTS_VIEW,
  opsControlFocusedTabAtom,
  opsControlPeekHostAtom,
  opsControlProjectsViewAtom,
  workstationTabHeaderAtomByHost,
} from "@src/store/workstation/workstationTabBarAtoms";

/** Release transient state that can retain the unmounted Ops Control tree. */
export const disposeOpsControlStateAtom = atom(null, (_get, set) => {
  set(opsControlCreatorVisibleAtom, false);
  set(opsControlProjectsViewAtom, OPS_CONTROL_PROJECTS_VIEW.WORK_ITEMS);
  set(opsControlPeekHostAtom, null);
  set(opsControlFocusedTabAtom, null);
  set(workstationTabHeaderAtomByHost.opsControl, null);

  set(kanbanSelectedTaskIdAtom, null);
  set(kanbanDetailPanelVisibleAtom, false);
  set(kanbanReplayCursorAtom, null);
  set(kanbanReplayModeAtom, "follow");
  set(kanbanReplayBoundsAtom, { start: 0, end: 0 });
  set(kanbanReplayEventsAtom, []);
  set(kanbanReplayPlayingAtom, false);
  set(kanbanReplaySpeedAtom, 1);
});
disposeOpsControlStateAtom.debugLabel = "disposeOpsControlState";

/**
 * CursorModePill (in-session)
 *
 * Cursor IDE-specific unified-mode pill shown in `InputArea` when the
 * focused session is a `cursoride-*` row. Sits next to the model pill
 * and gives the user the same Agent / Plan / Debug / Ask / Multitask /
 * Project switch they'd see inside Cursor's own picker.
 *
 * Lazy list fetches are cached app-wide; picked mode remains local to the
 * mounted pill until a mode-switch action explicitly applies it.
 */
import React, { memo } from "react";

import { composerIdFromSessionId } from "@src/util/session/sessionDispatch";

import CursorModePillView from "./CursorModePillView";
import { useCursorModes } from "./useCursorModes";

interface CursorModePillProps {
  /** Cursor IDE session id (`cursoride-<composerId>`). */
  sessionId: string;
}

const CursorModePill: React.FC<CursorModePillProps> = memo(({ sessionId }) => {
  const composerId = composerIdFromSessionId(sessionId);
  const cursorModes = useCursorModes(composerId);

  const { effectiveMode, modes, modeSource, loading, refresh, selectMode } =
    cursorModes;

  return (
    <CursorModePillView
      effectiveMode={effectiveMode}
      modes={modes}
      modeSource={modeSource}
      loading={loading}
      refresh={refresh}
      selectMode={selectMode}
    />
  );
});

CursorModePill.displayName = "CursorModePill";

export default CursorModePill;

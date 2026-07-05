/**
 * CursorModelPill (in-session)
 *
 * Cursor IDE-specific model pill shown in `InputArea` when the focused
 * session is a `cursoride-*` row. Replaces the regular {@link ModelPill}
 * because Cursor's available models are a *separate* universe from
 * ORGII's provider/listing model space — they're whatever the user's
 * Cursor entitlement currently allows, fetched live from the probe via
 * CDP (or read from disk while the probe is starting).
 *
 * Differences from `ModelPill`:
 *  - No source segment. Cursor IDE chats only have one "source" — the
 *    probe Cursor — so the second pill would be redundant.
 *  - Picks are local to the draft and only update the visible pill state.
 *    Cursor history rows are external-history sessions, so in-session model
 *    selection is informational rather than a submit-time override.
 *  - Lazy model list. `listModels()` only fires the first time the
 *    dropdown is opened — at rest we just show whatever the composer
 *    last used (read from `state.vscdb` once on mount).
 */
import React, { memo } from "react";

import { composerIdFromSessionId } from "@src/util/session/sessionDispatch";

import CursorModelPillView from "./CursorModelPillView";
import { useCursorModels } from "./useCursorModels";

interface CursorModelPillProps {
  /** Cursor IDE session id (`cursoride-<composerId>`). */
  sessionId: string;
}

const CursorModelPill: React.FC<CursorModelPillProps> = memo(
  ({ sessionId }) => {
    const composerId = composerIdFromSessionId(sessionId);
    const cursorModels = useCursorModels(composerId);

    const {
      effectiveModel,
      models,
      modelSource,
      loading,
      error,
      refresh,
      selectModel,
    } = cursorModels;

    return (
      <CursorModelPillView
        effectiveModel={effectiveModel}
        models={models}
        modelSource={modelSource}
        loading={loading}
        error={error}
        refresh={refresh}
        selectModel={selectModel}
        dropdownPlacement="top"
      />
    );
  }
);

CursorModelPill.displayName = "CursorModelPill";

export default CursorModelPill;

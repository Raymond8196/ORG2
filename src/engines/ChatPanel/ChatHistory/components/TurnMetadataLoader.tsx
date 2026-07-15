import { useStore } from "jotai";
import React, { memo, useEffect } from "react";

import { loadTurnIndex } from "@src/engines/SessionCore/storage/cacheAdapter";

import { turnMetadataAtomFamily, turnMetadataKey } from "../turnMetadataAtom";

interface TurnMetadataLoaderProps {
  sessionId: string | null;
  reloadKey: string;
  turnIds: readonly (string | null)[];
}

/**
 * Loads materialized round metadata without putting the result in
 * ChatHistory state. Only footer slots subscribed to the affected turn atoms
 * update when the DB response arrives.
 */
const TurnMetadataLoader: React.FC<TurnMetadataLoaderProps> = memo(
  ({ sessionId, reloadKey, turnIds }) => {
    const store = useStore();

    useEffect(() => {
      if (!sessionId) return;
      let cancelled = false;

      void loadTurnIndex(sessionId)
        .then((turns) => {
          if (cancelled) return;
          const summaries = new Map(turns.map((turn) => [turn.turnId, turn]));
          for (const turnId of turnIds) {
            if (!turnId) continue;
            store.set(
              turnMetadataAtomFamily(turnMetadataKey(sessionId, turnId)),
              summaries.get(turnId) ?? null
            );
          }
        })
        .catch(() => {
          if (cancelled) return;
          // Keep `undefined` on load failure: the footer must not claim that
          // a round had no changes when metadata was simply unavailable.
          for (const turnId of turnIds) {
            if (!turnId) continue;
            store.set(
              turnMetadataAtomFamily(turnMetadataKey(sessionId, turnId)),
              undefined
            );
          }
        });

      return () => {
        cancelled = true;
      };
    }, [reloadKey, sessionId, store, turnIds]);

    return null;
  }
);

TurnMetadataLoader.displayName = "TurnMetadataLoader";

export default TurnMetadataLoader;

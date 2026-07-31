/**
 * Local (non-cloud) channel MESSAGES — the single-user message plane that
 * sits under `localChannelsAtom`'s control plane, persisted on this machine
 * only.
 *
 * The cloud control plane shipped by `0014_org_channels.sql` has no message
 * RPCs yet, so cloud channels render the same surface with a disabled
 * composer. Local channels get a working plane instead, and the pure reducers
 * below pre-commit to the semantics the eventual cloud message RPCs will
 * carry, so a later migration cannot surprise the UI:
 *   - bodies are trimmed and bounded to 1..`LOCAL_CHANNEL_MESSAGE_MAX_LENGTH`
 *     (the same 4000 ceiling as the cloud comment plane),
 *   - delete is a TOMBSTONE (`deletedAt` stamped, body blanked at read time)
 *     so a message's slot in the transcript survives its removal — exactly
 *     how `CommentThreadList` renders "comment deleted",
 *   - each channel is capped at `LOCAL_CHANNEL_MESSAGE_MAX_PER_CHANNEL` rows.
 *
 * Authorship is implicit: this store is single-user by construction, so every
 * row is the local user's and edit/delete are never role-gated.
 *
 * Persistence uses the same zod-validated localStorage idiom as
 * `localChannelsAtom`: garbage bytes parse to the initial empty list instead
 * of crashing hydration, and a single malformed row degrades just that row.
 */
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

/** Colon-style key (codebase convention); the dot-style original is adopted below. */
export const LOCAL_CHANNEL_MESSAGES_STORAGE_KEY =
  "orgii:localChannelMessages:v1";
const LEGACY_LOCAL_CHANNEL_MESSAGES_STORAGE_KEY =
  "orgii.localChannelMessages.v1";

// One-time adoption of the briefly-shipped dot-style key.
try {
  if (typeof localStorage !== "undefined") {
    const legacy = localStorage.getItem(
      LEGACY_LOCAL_CHANNEL_MESSAGES_STORAGE_KEY
    );
    if (legacy !== null) {
      if (localStorage.getItem(LOCAL_CHANNEL_MESSAGES_STORAGE_KEY) === null) {
        localStorage.setItem(LOCAL_CHANNEL_MESSAGES_STORAGE_KEY, legacy);
      }
      localStorage.removeItem(LEGACY_LOCAL_CHANNEL_MESSAGES_STORAGE_KEY);
    }
  }
} catch {
  // Storage unavailable — nothing to migrate.
}

/** Same body ceiling as the cloud session-comment plane. */
export const LOCAL_CHANNEL_MESSAGE_MAX_LENGTH = 4000;

/** Per-channel row cap; posting past it fails with `"quota"`. */
export const LOCAL_CHANNEL_MESSAGE_MAX_PER_CHANNEL = 5000;

export const LocalChannelMessageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  body: z.string(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

export type LocalChannelMessage = z.output<typeof LocalChannelMessageSchema>;

/** Tolerant list schema: drop malformed rows (logged), keep the rest. */
const StoredLocalChannelMessagesSchema: z.ZodType<LocalChannelMessage[]> = z
  .array(z.unknown())
  .transform((rows) =>
    rows.flatMap((row) => {
      const parsed = LocalChannelMessageSchema.safeParse(row);
      if (!parsed.success) {
        // Trace per-row drops — the next whole-list write makes them final.
        console.warn("[localChannelMessages] dropped malformed row", row);
        return [];
      }
      return [parsed.data];
    })
  );

export const localChannelMessagesAtom = atomWithStorage<LocalChannelMessage[]>(
  LOCAL_CHANNEL_MESSAGES_STORAGE_KEY,
  [],
  createZodJsonStorage(StoredLocalChannelMessagesSchema, {
    onInvalid: (key, _rawValue, error) => {
      console.warn(
        `[localChannelMessages] invalid stored payload for ${key}`,
        error
      );
    },
  }),
  { getOnInit: true }
);
localChannelMessagesAtom.debugLabel = "localChannelMessagesAtom";

// ---------------------------------------------------------------------------
// Pure reducers
// ---------------------------------------------------------------------------

export type LocalChannelMessageErrorCode =
  | "empty"
  | "tooLong"
  | "quota"
  | "invalid";

export type LocalChannelMessageResult =
  | {
      ok: true;
      messages: LocalChannelMessage[];
      message: LocalChannelMessage;
    }
  | { ok: false; error: LocalChannelMessageErrorCode };

function fail(error: LocalChannelMessageErrorCode): LocalChannelMessageResult {
  return { ok: false, error };
}

/**
 * Trim first, then bound. `"empty"` and `"tooLong"` stay distinct so the
 * composer can explain WHY a submit was refused rather than silently no-op.
 */
function normalizeBody(
  raw: string
): { ok: true; body: string } | { ok: false; error: "empty" | "tooLong" } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (trimmed.length > LOCAL_CHANNEL_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: "tooLong" };
  }
  return { ok: true, body: trimmed };
}

/**
 * LIVE rows for a channel — tombstones do NOT hold a slot. Counting them
 * made a full channel permanently read-only (deleting messages never freed
 * room), and the cloud design has no per-channel cap at all; the local cap
 * is purely a storage bound. Stored tombstones are compacted oldest-first
 * on post once the total row count reaches the cap.
 */
function countLiveChannelMessages(
  messages: readonly LocalChannelMessage[],
  channelId: string
): number {
  return messages.reduce(
    (count, message) =>
      message.channelId === channelId && message.deletedAt === null
        ? count + 1
        : count,
    0
  );
}

/** Evict oldest tombstones of the channel until its total rows fit the cap. */
function compactChannelTombstones(
  messages: readonly LocalChannelMessage[],
  channelId: string
): readonly LocalChannelMessage[] {
  const totalRows = messages.reduce(
    (count, message) => (message.channelId === channelId ? count + 1 : count),
    0
  );
  let toEvict = totalRows - (LOCAL_CHANNEL_MESSAGE_MAX_PER_CHANNEL - 1);
  if (toEvict <= 0) return messages;
  const evictIds = new Set<string>();
  for (const message of messages) {
    if (toEvict === 0) break;
    if (message.channelId === channelId && message.deletedAt !== null) {
      evictIds.add(message.id);
      toEvict -= 1;
    }
  }
  if (evictIds.size === 0) return messages;
  return messages.filter((message) => !evictIds.has(message.id));
}

export interface PostLocalChannelMessageInput {
  channelId: string;
  body: string;
  /** Injectable for tests; defaults to `crypto.randomUUID()`. */
  id?: string;
  /** Injectable for tests; defaults to `new Date().toISOString()`. */
  now?: string;
}

export function postLocalChannelMessage(
  messages: readonly LocalChannelMessage[],
  input: PostLocalChannelMessageInput
): LocalChannelMessageResult {
  if (input.channelId.length === 0) return fail("invalid");
  const body = normalizeBody(input.body);
  if (!body.ok) return fail(body.error);
  if (
    countLiveChannelMessages(messages, input.channelId) >=
    LOCAL_CHANNEL_MESSAGE_MAX_PER_CHANNEL
  ) {
    return fail("quota");
  }
  const compacted = compactChannelTombstones(messages, input.channelId);

  const message: LocalChannelMessage = {
    id: input.id ?? crypto.randomUUID(),
    channelId: input.channelId,
    body: body.body,
    createdAt: input.now ?? new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
  };
  return { ok: true, messages: [...compacted, message], message };
}

export interface EditLocalChannelMessageInput {
  body: string;
  now?: string;
}

/**
 * Edit in place. The author is always the single local user, so there is no
 * ownership check; a tombstone is not editable (its body no longer exists).
 */
export function editLocalChannelMessage(
  messages: readonly LocalChannelMessage[],
  id: string,
  input: EditLocalChannelMessageInput
): LocalChannelMessageResult {
  const current = messages.find((message) => message.id === id);
  if (!current || current.deletedAt !== null) return fail("invalid");
  const body = normalizeBody(input.body);
  if (!body.ok) return fail(body.error);

  const updated: LocalChannelMessage = {
    ...current,
    body: body.body,
    editedAt: input.now ?? new Date().toISOString(),
  };
  return {
    ok: true,
    messages: messages.map((message) =>
      message.id === id ? updated : message
    ),
    message: updated,
  };
}

/**
 * TOMBSTONE delete — the row survives with `deletedAt` stamped so the
 * transcript keeps its slot; `selectLocalChannelMessages` blanks the body at
 * read time (cloud comment-plane parity). Deleting twice is idempotent.
 */
export function deleteLocalChannelMessage(
  messages: readonly LocalChannelMessage[],
  id: string,
  now?: string
): LocalChannelMessageResult {
  const current = messages.find((message) => message.id === id);
  if (!current) return fail("invalid");
  if (current.deletedAt !== null) {
    return { ok: true, messages: [...messages], message: current };
  }
  const updated: LocalChannelMessage = {
    ...current,
    body: "",
    deletedAt: now ?? new Date().toISOString(),
  };
  return {
    ok: true,
    messages: messages.map((message) =>
      message.id === id ? updated : message
    ),
    message: updated,
  };
}

/**
 * Drop every row of a channel outright. Deleting a local channel is a HARD
 * delete (`deleteLocalChannel`), so its messages must not linger as orphans
 * that a recreated same-name channel could never reach but storage still pays
 * for. Returns the surviving rows (not a `LocalChannelMessageResult`: there is
 * no single subject message and purging an empty channel is not an error).
 */
export function purgeLocalChannelMessages(
  messages: readonly LocalChannelMessage[],
  channelId: string
): LocalChannelMessage[] {
  return messages.filter((message) => message.channelId !== channelId);
}

/**
 * One channel's messages, oldest first — the transcript's render order.
 * Tombstoned rows are kept (they render as "message deleted") but their body
 * is blanked here so a stale persisted body can never leak back into the UI.
 */
export function selectLocalChannelMessages(
  messages: readonly LocalChannelMessage[],
  channelId: string
): LocalChannelMessage[] {
  return (
    messages
      .filter((message) => message.channelId === channelId)
      .map((message) =>
        message.deletedAt === null ? message : { ...message, body: "" }
      )
      // Codepoint compare: ISO-8601 strings order lexicographically; locale
      // collation is both slower and locale-dependent for pure timestamps.
      .sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
      )
  );
}

// ---------------------------------------------------------------------------
// Derived read atoms + reducer-wrapping write atoms
// ---------------------------------------------------------------------------

/**
 * Live messages for one channel, ascending by `createdAt`. Keyed per channel
 * so a channel surface only re-renders when ITS rows change.
 */
export const localChannelMessagesForChannelAtomFamily = atomFamily(
  (channelId: string) => {
    const derived = atom((get) =>
      selectLocalChannelMessages(get(localChannelMessagesAtom), channelId)
    );
    derived.debugLabel = `localChannelMessagesForChannelAtom/${channelId}`;
    return derived;
  }
);

export const postLocalChannelMessageAtom = atom(
  null,
  (
    get,
    set,
    input: PostLocalChannelMessageInput
  ): LocalChannelMessageResult => {
    const result = postLocalChannelMessage(
      get(localChannelMessagesAtom),
      input
    );
    if (result.ok) set(localChannelMessagesAtom, result.messages);
    return result;
  }
);
postLocalChannelMessageAtom.debugLabel = "postLocalChannelMessageAtom";

export const editLocalChannelMessageAtom = atom(
  null,
  (
    get,
    set,
    args: { id: string } & EditLocalChannelMessageInput
  ): LocalChannelMessageResult => {
    const { id, ...input } = args;
    const result = editLocalChannelMessage(
      get(localChannelMessagesAtom),
      id,
      input
    );
    if (result.ok) set(localChannelMessagesAtom, result.messages);
    return result;
  }
);
editLocalChannelMessageAtom.debugLabel = "editLocalChannelMessageAtom";

export const deleteLocalChannelMessageAtom = atom(
  null,
  (get, set, id: string): LocalChannelMessageResult => {
    const result = deleteLocalChannelMessage(get(localChannelMessagesAtom), id);
    if (result.ok) set(localChannelMessagesAtom, result.messages);
    return result;
  }
);
deleteLocalChannelMessageAtom.debugLabel = "deleteLocalChannelMessageAtom";

/** Purge one channel's messages — `deleteLocalChannelAtom` composes this. */
export const purgeLocalChannelMessagesAtom = atom(
  null,
  (get, set, channelId: string): LocalChannelMessage[] => {
    const messages = get(localChannelMessagesAtom);
    const remaining = purgeLocalChannelMessages(messages, channelId);
    if (remaining.length !== messages.length) {
      set(localChannelMessagesAtom, remaining);
    }
    return remaining;
  }
);
purgeLocalChannelMessagesAtom.debugLabel = "purgeLocalChannelMessagesAtom";

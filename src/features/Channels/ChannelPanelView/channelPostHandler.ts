/**
 * The channel post handler, factored out of the view so it can be tested
 * without driving `InputArea`'s contenteditable editor.
 *
 * `InputArea` submits through `onSubmitOverride` (see `useSubmitMessage`), and
 * that contract is NOT "return false on failure":
 *
 *  - resolving `true`  → handled; the composer does not fall through to the
 *    agent submit path (which a channel has no business reaching).
 *  - THROWING          → the send failed; `useSubmitMessage` restores the
 *    editor snapshot it captured before the optimistic clear.
 *
 * So a refused post must throw. That is what keeps the draft on screen the way
 * the old hand-rolled textarea did by returning `false`.
 */
import type { SubmitOverrideInput } from "@src/engines/ChatPanel/hooks/useInputArea/types";
import type {
  LocalChannelMessageErrorCode,
  LocalChannelMessageResult,
} from "@src/store/ui/localChannelMessagesAtom";

/** Refusal code → `navigation` namespace key. */
export const CHANNEL_POST_ERROR_KEYS: Record<
  LocalChannelMessageErrorCode,
  string
> = {
  empty: "cloud.channels.feed.errorEmpty",
  tooLong: "cloud.channels.feed.errorTooLong",
  quota: "cloud.channels.feed.errorQuota",
  invalid: "cloud.channels.feed.errorGeneric",
};

export interface ChannelPostHandlerDeps {
  /** Writes the post; the local message store's reducer result. */
  post: (body: string) => LocalChannelMessageResult;
  /** Localizes a refusal key from `CHANNEL_POST_ERROR_KEYS`. */
  translate: (key: string) => string;
  /** Publishes the inline refusal copy; called with `null` on success. */
  onError: (message: string | null) => void;
}

export type ChannelPostHandler = (
  input: SubmitOverrideInput
) => Promise<boolean>;

/**
 * Builds the `onSubmitOverride` a channel composer hands to `InputArea`.
 *
 * Whitespace-only submits resolve `true` without touching the store: the
 * composer already refuses to send an empty editor, and reporting `empty` back
 * as an error would flash a message the user never caused.
 */
export function createChannelPostHandler(
  deps: ChannelPostHandlerDeps
): ChannelPostHandler {
  const { post, translate, onError } = deps;
  return async ({ displayText }: SubmitOverrideInput): Promise<boolean> => {
    const body = displayText.trim();
    if (body.length === 0) return true;

    const result = post(body);
    if (result.ok) {
      onError(null);
      return true;
    }

    const message = translate(CHANNEL_POST_ERROR_KEYS[result.error]);
    onError(message);
    throw new Error(message);
  };
}

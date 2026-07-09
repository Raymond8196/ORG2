import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { promptPolish as requestPromptPolish } from "@src/api/services/keyValidation";
import type { ComposerSnapshot } from "@src/components/ComposerInput/types";
import Message from "@src/components/Message";
import { useHousekeeperConfig } from "@src/hooks/housekeeper";

import {
  polishedTextToSnapshot,
  snapshotHasPolishableText,
  snapshotSignature,
  snapshotToPolishText,
} from "../../InputArea/promptPolish/snapshotPlaceholders";
import type {
  InputAreaRefs,
  PromptPolishControl,
  PromptPolishStatus,
} from "./types";

interface UsePromptPolishOptions {
  refs: InputAreaRefs;
  draftSessionId: string;
  setDraft: (text: string) => void;
  handleSessInputChange: (text: string) => void;
  withProgrammaticInputMutation: (mutation: () => void) => void;
}

interface PromptPolishRestoreState {
  sessionId: string;
  originalSnapshot: ComposerSnapshot;
  polishedSignature: string;
}

interface PromptPolishState {
  sessionId: string;
  status: PromptPolishStatus;
}

function formatPromptPolishError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[RPC:prompt_polish\]\s*/, "");
}

export function usePromptPolish({
  refs,
  draftSessionId,
  setDraft,
  handleSessInputChange,
  withProgrammaticInputMutation,
}: UsePromptPolishOptions): PromptPolishControl & {
  handleContentChange: () => void;
} {
  const [state, setState] = useState<PromptPolishState>({
    sessionId: draftSessionId,
    status: "idle",
  });
  const restoreStateRef = useRef<PromptPolishRestoreState | null>(null);
  const draftSessionIdRef = useRef(draftSessionId);
  const housekeeper = useHousekeeperConfig();

  useEffect(() => {
    draftSessionIdRef.current = draftSessionId;
  }, [draftSessionId]);

  const status =
    state.sessionId === draftSessionId ? state.status : ("idle" as const);
  const isAvailable = housekeeper.enabled && housekeeper.features.promptPolish;

  const setStatus = useCallback(
    (nextStatus: PromptPolishStatus) => {
      setState({ sessionId: draftSessionId, status: nextStatus });
    },
    [draftSessionId]
  );

  const reset = useCallback(() => {
    restoreStateRef.current = null;
    setStatus("idle");
  }, [setStatus]);

  const applyComposerContent = useCallback(
    (content: string | ComposerSnapshot): string | null => {
      const editor = refs.composerInputRef.current;
      if (!editor) return null;

      withProgrammaticInputMutation(() => {
        editor.setContent(content);
      });

      const displayText = editor.getTextWithPills();
      refs.setHasContent(displayText.trim().length > 0);
      handleSessInputChange(displayText);
      if (draftSessionId) {
        setDraft(displayText);
      }
      editor.focus();
      return displayText;
    },
    [
      draftSessionId,
      handleSessInputChange,
      refs,
      setDraft,
      withProgrammaticInputMutation,
    ]
  );

  const handleContentChange = useCallback(() => {
    const restoreState = restoreStateRef.current;
    const editor = refs.composerInputRef.current;
    if (!restoreState || restoreState.sessionId !== draftSessionId || !editor) {
      return;
    }

    const currentSignature = snapshotSignature(editor.getSnapshot());
    if (currentSignature !== restoreState.polishedSignature) {
      restoreStateRef.current = null;
      setStatus("idle");
    }
  }, [draftSessionId, refs, setStatus]);

  const toggle = useCallback(async () => {
    const editor = refs.composerInputRef.current;
    if (!editor || status === "polishing") return;

    const restoreState = restoreStateRef.current;
    if (status === "polished" && restoreState?.sessionId === draftSessionId) {
      applyComposerContent(restoreState.originalSnapshot);
      reset();
      return;
    }

    const originalSnapshot = editor.getSnapshot();
    if (!snapshotHasPolishableText(originalSnapshot)) {
      Message.info("请输入需要润色的文字");
      return;
    }

    const originalSignature = snapshotSignature(originalSnapshot);
    const polishInput = snapshotToPolishText(originalSnapshot);
    const requestSessionId = draftSessionId;
    setStatus("polishing");

    try {
      if (!isAvailable) {
        reset();
        Message.warning("MiniCPM 常驻管家的输入润色已关闭");
        return;
      }

      const result = await requestPromptPolish(polishInput.text, {
        accountId: housekeeper.resolvedAccountId ?? undefined,
        model: housekeeper.resolvedModel,
      });
      if (draftSessionIdRef.current !== requestSessionId) {
        setState({ sessionId: requestSessionId, status: "idle" });
        return;
      }

      const currentSignature = snapshotSignature(editor.getSnapshot());
      if (currentSignature !== originalSignature) {
        reset();
        Message.info("内容已变化，已取消本次润色");
        return;
      }

      const nextContent =
        polishInput.pills.length > 0
          ? polishedTextToSnapshot(result.polishedText, polishInput.pills)
          : result.polishedText.trim();
      if (!nextContent) {
        reset();
        Message.warning("润色结果未保留引用内容，已保留原文");
        return;
      }

      applyComposerContent(nextContent);
      restoreStateRef.current = {
        sessionId: requestSessionId,
        originalSnapshot,
        polishedSignature: snapshotSignature(editor.getSnapshot()),
      };
      setStatus("polished");
    } catch (error) {
      reset();
      Message.error(`润色失败：${formatPromptPolishError(error)}`);
    }
  }, [
    applyComposerContent,
    draftSessionId,
    isAvailable,
    housekeeper.resolvedAccountId,
    housekeeper.resolvedModel,
    refs,
    reset,
    setStatus,
    status,
  ]);

  return useMemo(
    () => ({
      status,
      isAvailable,
      isPolishing: status === "polishing",
      isPolished: status === "polished",
      toggle,
      reset,
      handleContentChange,
    }),
    [handleContentChange, isAvailable, reset, status, toggle]
  );
}

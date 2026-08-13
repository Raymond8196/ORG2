import { useCallback, useEffect, useRef, useState } from "react";

import type { CanvasInlinePayload } from "@src/engines/ChatPanel/blocks/CanvasInlineCard/types";
import { copyText } from "@src/util/data/clipboard";

import {
  getOrCreateCanvasShareLink,
  invalidateCanvasShareLink,
} from "./canvasShareCache";
import {
  type CanvasShareLinkResult,
  CanvasShareProtocolError,
} from "./canvasShareProtocol";

export type CanvasShareDialogError =
  | "source-too-large"
  | "unsupported-runtime"
  | "invalid-payload"
  | "copy-failed"
  | "unknown";

export type CanvasShareDialogState =
  | { phase: "closed"; operationId: number }
  | { phase: "preparing"; operationId: number; title: string }
  | {
      phase: "ready";
      operationId: number;
      title: string;
      payload: CanvasInlinePayload;
      link: string;
      linkKind: CanvasShareLinkResult["kind"];
      expiresAt?: string;
      copied: boolean;
      copyError: boolean;
      retryingShortLink: boolean;
    }
  | {
      phase: "error";
      operationId: number;
      title: string;
      payload: CanvasInlinePayload;
      error: CanvasShareDialogError;
    };

function classifyError(error: unknown): CanvasShareDialogError {
  if (!(error instanceof CanvasShareProtocolError)) return "unknown";
  if (error.code === "link-too-large" || error.code === "source-too-large") {
    return "source-too-large";
  }
  if (error.code === "short-link-unavailable") return "unknown";
  return error.code;
}

export function useCanvasShareDialog() {
  const operationRef = useRef(0);
  const [state, setState] = useState<CanvasShareDialogState>({
    phase: "closed",
    operationId: 0,
  });

  const prepare = useCallback((payload: CanvasInlinePayload, title: string) => {
    const operationId = ++operationRef.current;
    const cached = getOrCreateCanvasShareLink(payload);

    if (cached.phase === "ready") {
      setState({
        phase: "ready",
        operationId,
        title,
        payload,
        link: cached.result.link,
        linkKind: cached.result.kind,
        ...(cached.result.kind === "short"
          ? { expiresAt: cached.result.expiresAt }
          : {}),
        copied: false,
        copyError: false,
        retryingShortLink: false,
      });
      return;
    }

    setState({ phase: "preparing", operationId, title });
    void cached.promise.then(
      (result) => {
        if (operationRef.current !== operationId) return;
        setState({
          phase: "ready",
          operationId,
          title,
          payload,
          link: result.link,
          linkKind: result.kind,
          ...(result.kind === "short" ? { expiresAt: result.expiresAt } : {}),
          copied: false,
          copyError: false,
          retryingShortLink: false,
        });
      },
      (error: unknown) => {
        if (operationRef.current !== operationId) return;
        setState({
          phase: "error",
          operationId,
          title,
          payload,
          error: classifyError(error),
        });
      }
    );
  }, []);

  const open = useCallback(
    (payload: CanvasInlinePayload, title: string) => {
      prepare(payload, title);
    },
    [prepare]
  );

  const close = useCallback(() => {
    const operationId = ++operationRef.current;
    setState({ phase: "closed", operationId });
  }, []);

  // The app-level cache owns in-flight requests across tab remounts. This
  // cleanup only invalidates the unmounted dialog's promise subscriber.
  useEffect(
    () => () => {
      operationRef.current += 1;
    },
    []
  );

  const retry = useCallback(() => {
    if (state.phase !== "error") return;
    prepare(state.payload, state.title);
  }, [prepare, state]);

  const retryShortLink = useCallback(() => {
    if (
      state.phase !== "ready" ||
      state.linkKind !== "self-contained" ||
      state.retryingShortLink
    ) {
      return;
    }

    const previous = state;
    const operationId = ++operationRef.current;
    invalidateCanvasShareLink(state.payload);
    const cached = getOrCreateCanvasShareLink(state.payload);

    if (cached.phase === "ready") {
      setState({
        phase: "ready",
        operationId,
        title: state.title,
        payload: state.payload,
        link: cached.result.link,
        linkKind: cached.result.kind,
        ...(cached.result.kind === "short"
          ? { expiresAt: cached.result.expiresAt }
          : {}),
        copied: false,
        copyError: false,
        retryingShortLink: false,
      });
      return;
    }

    setState({ ...state, operationId, retryingShortLink: true });
    void cached.promise.then(
      (result) => {
        if (operationRef.current !== operationId) return;
        setState({
          phase: "ready",
          operationId,
          title: state.title,
          payload: state.payload,
          link: result.link,
          linkKind: result.kind,
          ...(result.kind === "short" ? { expiresAt: result.expiresAt } : {}),
          copied: false,
          copyError: false,
          retryingShortLink: false,
        });
      },
      () => {
        if (operationRef.current !== operationId) return;
        setState({
          ...previous,
          operationId,
          retryingShortLink: false,
        });
      }
    );
  }, [state]);

  const copy = useCallback(async () => {
    if (state.phase !== "ready") return;
    const { operationId, link } = state;
    try {
      await copyText(link);
      if (operationRef.current !== operationId) return;
      setState((current) =>
        current.phase === "ready" && current.operationId === operationId
          ? { ...current, copied: true, copyError: false }
          : current
      );
    } catch {
      if (operationRef.current !== operationId) return;
      setState((current) =>
        current.phase === "ready" && current.operationId === operationId
          ? { ...current, copied: false, copyError: true }
          : current
      );
    }
  }, [state]);

  return { state, open, close, retry, retryShortLink, copy };
}

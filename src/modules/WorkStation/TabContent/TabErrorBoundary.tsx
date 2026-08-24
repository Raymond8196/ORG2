/**
 * Error boundary scoped to a single tab's content.
 *
 * Without this, a renderer that throws — a chunk that failed every retry, or a
 * missing host context — escapes `UnifiedTabContent`'s `Suspense` and lands on
 * React Router's route-level `errorElement`, replacing the entire `/orgii`
 * surface with the full-page error screen. One unreachable chunk should cost
 * one tab, not the whole workstation.
 *
 * This deliberately catches every error, not just chunk errors. Swallowing a
 * genuine programming error into a tab-sized panel does hide it from the user,
 * so the boundary logs at error level and surfaces the raw message as the
 * panel's subtitle rather than showing only generic copy.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@src/hooks/logger/useLogger";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { WorkStationTabType } from "@src/store/workstation/tabs/types";
import {
  isChunkLoadError,
  recoverFromChunkLoadFailure,
} from "@src/util/core/init/chunkReload";

const log = createLogger("TabErrorBoundary");

interface TabErrorFallbackProps {
  error: Error;
  onRetry: () => void;
}

const TabErrorFallback: React.FC<TabErrorFallbackProps> = ({
  error,
  onRetry,
}) => {
  const { t } = useTranslation();
  const chunkError = isChunkLoadError(error);

  return (
    <Placeholder
      variant="error"
      placement="detail-panel"
      title={
        chunkError
          ? t("errors.failedToLoadComponent")
          : t("errors.applicationError")
      }
      subtitle={
        chunkError ? t("errors.requiredFileCouldntLoad") : error.message
      }
      onRetry={onRetry}
      fillParentHeight
    />
  );
};

interface TabErrorBoundaryProps {
  tabId: string;
  tabType: WorkStationTabType;
  /**
   * Discard the cached lazy component and re-render. Required because
   * `React.lazy` caches a rejection permanently — clearing this boundary's
   * state alone would replay the same error.
   */
  onRetry: () => void;
  children: React.ReactNode;
}

interface TabErrorBoundaryState {
  error: Error | null;
  tabId: string;
}

export class TabErrorBoundary extends React.Component<
  TabErrorBoundaryProps,
  TabErrorBoundaryState
> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = { error: null, tabId: props.tabId };
  }

  static getDerivedStateFromProps(
    props: TabErrorBoundaryProps,
    state: TabErrorBoundaryState
  ): Partial<TabErrorBoundaryState> | null {
    if (props.tabId !== state.tabId) {
      return { error: null, tabId: props.tabId };
    }
    return null;
  }

  static getDerivedStateFromError(
    error: Error
  ): Partial<TabErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    log.error(
      `Tab "${this.props.tabType}" failed to render:`,
      error,
      errorInfo.componentStack
    );

    if (isChunkLoadError(error)) {
      recoverFromChunkLoadFailure({
        failure: error,
        surface: "runtime",
        // The boundary already committed its tab-local error panel.
        onGiveUp: () => undefined,
      });
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
    this.props.onRetry();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return <TabErrorFallback error={error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

export default TabErrorBoundary;

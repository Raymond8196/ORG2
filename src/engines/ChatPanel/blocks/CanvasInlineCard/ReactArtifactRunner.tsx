import React, { useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LiveContext, LivePreview, LiveProvider } from "react-live";

export interface ReactArtifactError {
  message: string;
  stack?: string;
}

export interface ReactArtifactRunnerProps {
  source: string;
  onError?: (error: ReactArtifactError) => void;
  /**
   * Test seam for the module-level CSP probe. Production callers omit it and
   * get the real environment capability.
   */
  evalAvailable?: boolean;
}

// react-live retranspiles whenever `scope` changes by reference. A module-level
// immutable scope keeps parent-only renders (such as Canvas hover overlays)
// from replacing the preview DOM and resetting the generated app's state.
const REACT_LIVE_SCOPE = Object.freeze({ React });

/**
 * The packaged app ships `script-src 'self' 'wasm-unsafe-eval'` (no
 * `unsafe-eval`), so react-live's `new Function` compile step throws an
 * EvalError before anything renders. Sandboxed srcdoc iframes inherit the same
 * policy in WebView2, so an in-app runtime cannot execute generated code
 * either. Probe once at module init; when eval is unavailable every runner
 * instance renders an explicit localized notice instead of a silent black
 * card.
 */
function detectEvalAvailability(): boolean {
  try {
    // eslint-disable-next-line no-new-func
    new Function("");
    return true;
  } catch {
    return false;
  }
}

const EVAL_AVAILABLE = detectEvalAvailability();

export function normalizeReactLiveSource(source: string): string {
  let code = source.replace(
    /^\s*import\s+React(?:\s*,\s*\{[^}]*\})?\s+from\s+["']react["'];?\s*$/gm,
    ""
  );
  code = code.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+["']react["'];?\s*$/gm,
    ""
  );

  if (/\bexport\s+default\s+function\s+App\s*\(/.test(code)) {
    code = code.replace(
      /\bexport\s+default\s+function\s+App\s*\(/,
      "function App("
    );
    return `${code}\nrender(<App />);`;
  }

  if (/\bexport\s+default\s+function\s*\(/.test(code)) {
    code = code.replace(/\bexport\s+default\s+function\s*\(/, "function App(");
    return `${code}\nrender(<App />);`;
  }

  const namedDefaultMatch = code.match(
    /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/
  );
  if (namedDefaultMatch) {
    code = code.replace(namedDefaultMatch[0], "");
    return `${code}\nrender(<${namedDefaultMatch[1]} />);`;
  }

  if (/\bexport\s+default\s+/.test(code)) {
    code = code.replace(/\bexport\s+default\s+/, "const App = ");
    return `${code}\nrender(<App />);`;
  }

  if (/\bfunction\s+App\s*\(|\bconst\s+App\s*=|\blet\s+App\s*=/.test(code)) {
    return `${code}\nrender(<App />);`;
  }

  return code;
}

/**
 * Visible error surface for react-live compile/runtime failures.
 *
 * react-live v4's `LiveError` spreads unknown props (including `onChange`)
 * straight onto a `<pre>`, so callbacks never fire and a hidden `LiveError`
 * leaves the card silently blank. Reading `LiveContext.error` directly both
 * renders an in-card banner and forwards the failure to `onError` for the
 * surrounding surface banner.
 */
const LiveErrorBanner: React.FC<{
  onError?: (error: ReactArtifactError) => void;
}> = ({ onError }) => {
  const { error } = useContext(LiveContext);

  useEffect(() => {
    if (error) onError?.({ message: error });
  }, [error, onError]);

  if (!error) return null;

  return (
    <pre
      role="alert"
      data-testid="react-artifact-error"
      className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-danger-6/40 bg-danger-6/10 p-2 font-mono text-[11px] leading-4 text-danger-6"
    >
      {error}
    </pre>
  );
};

/**
 * Explicit notice for builds whose CSP forbids `eval` — the artifact cannot
 * execute at all, so say so instead of leaving a blank card.
 */
const CspUnavailableNotice: React.FC<{
  onError?: (error: ReactArtifactError) => void;
}> = ({ onError }) => {
  const { t } = useTranslation("sessions");
  const message = t(
    "canvasApp.reactCspUnavailable",
    "React preview can't run in this build — open source view"
  );

  useEffect(() => {
    onError?.({ message });
  }, [message, onError]);

  return (
    <div
      role="alert"
      data-testid="react-artifact-csp-notice"
      className="flex h-full min-h-0 w-full items-center justify-center bg-bg-1 p-4"
    >
      <span className="max-w-sm text-center text-xs leading-5 text-text-3">
        {message}
      </span>
    </div>
  );
};

const ReactArtifactRunner: React.FC<ReactArtifactRunnerProps> = ({
  source,
  onError,
  evalAvailable = EVAL_AVAILABLE,
}) => {
  if (!evalAvailable) {
    return <CspUnavailableNotice onError={onError} />;
  }

  return (
    <LiveProvider
      code={normalizeReactLiveSource(source)}
      noInline
      scope={REACT_LIVE_SCOPE}
    >
      <div
        className="h-full min-h-0 w-full overflow-auto overscroll-contain bg-bg-1 p-4 text-text-1 [scrollbar-gutter:stable]"
        data-testid="react-artifact-scroll"
      >
        {/* Let a fixed/min-width artifact establish scrollable overflow before
            its own root-level overflow rules can clip the narrow viewport. */}
        <LivePreview
          className="min-h-full w-fit min-w-full"
          data-testid="react-artifact-preview"
        />
        <LiveErrorBanner onError={onError} />
      </div>
    </LiveProvider>
  );
};

export default ReactArtifactRunner;

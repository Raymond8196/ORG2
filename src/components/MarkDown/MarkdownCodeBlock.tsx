/**
 * MarkdownCodeBlock
 *
 * The default (non-chat) fenced code block: Prism-highlighted source with a
 * copy button and, for references inside the active repo, an open-in-editor
 * button. Memoized on its own props so streaming text does not re-highlight
 * completed blocks.
 */
import { Check, Copy, SquareArrowOutUpRight } from "lucide-react";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { codeMirrorPrismTheme } from "@src/features/CodeMirror/themes/prism";
import { useCopyCheck } from "@src/hooks/ui";
import { copyText } from "@src/util/data/clipboard";
import { PrismLight as SyntaxHighlighterPrism } from "@src/util/language/prismLight";
import { openFileInWorkStation } from "@src/util/ui/openFileInWorkStation";

const SyntaxHighlighter =
  SyntaxHighlighterPrism as unknown as React.ComponentType<
    Record<string, unknown>
  >;

// ============================================
// Static Styles (moved outside component for performance)
// ============================================

const CODE_CUSTOM_STYLE: React.CSSProperties = {
  fontFamily: "var(--cm-font-family)",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: 0,
  padding: "12px 14px",
  borderRadius: "8px",
  background: "transparent",
};

const CODE_WRAPPER_STYLE: React.CSSProperties = {
  border: "none",
  borderRadius: "8px",
  margin: "8px 0",
};

interface CodeBlockProps {
  children: string;
  language: string;
  startLine?: string;
  openFilePath?: string;
}

const CodeBlock = memo<CodeBlockProps>(
  ({ children, language, startLine, openFilePath }) => {
    const onCopyContent = useCallback(async () => {
      await copyText(children);
    }, [children]);
    const { copied, handleCopy } = useCopyCheck(onCopyContent);
    const { t } = useTranslation("common");

    const handleOpenFile = useCallback(() => {
      if (!openFilePath) return;
      const line = startLine ? Number.parseInt(startLine, 10) : undefined;
      openFileInWorkStation(openFilePath, {
        line: Number.isFinite(line) ? line : undefined,
      });
    }, [openFilePath, startLine]);

    const copyLabel = copied ? t("status.copied") : t("actions.copy");
    const openLabel = t("actions.open");

    return (
      <div className="code-block-wrapper" style={CODE_WRAPPER_STYLE}>
        <div className="code-block-toolbar">
          {openFilePath && (
            <button
              type="button"
              title={openLabel}
              aria-label={openLabel}
              className="code-block-open-button inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-fill-2 p-0 text-text-3 transition-colors hover:bg-fill-3 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/30"
              onClick={handleOpenFile}
            >
              <SquareArrowOutUpRight size={14} strokeWidth={1.75} />
            </button>
          )}
          <button
            type="button"
            title={copyLabel}
            aria-label={copyLabel}
            className="code-block-copy-button inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-fill-2 p-0 text-text-3 transition-colors hover:bg-fill-3 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/30"
            onClick={handleCopy}
          >
            {copied ? (
              <Check size={14} strokeWidth={1.75} />
            ) : (
              <Copy size={14} strokeWidth={1.75} />
            )}
          </button>
        </div>
        <SyntaxHighlighter
          customStyle={CODE_CUSTOM_STYLE}
          style={codeMirrorPrismTheme}
          language={language}
          PreTag="div"
          showLineNumbers={false}
          wrapLongLines
          wrapLines={true}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    );
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.language === next.language &&
    prev.startLine === next.startLine &&
    prev.openFilePath === next.openFilePath
);
CodeBlock.displayName = "CodeBlock";

export default CodeBlock;

/**
 * Chat models configuration (shared)
 *
 * IMPORTANT:
 * - This file must NOT import `WorkspaceContext` barrel exports to avoid circular deps.
 * - Keep this module UI-light and side-effect free; it is imported by `ChatContext`.
 */
import Book from "@hugeicons/core-free-icons/Book01Icon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import FileText from "@hugeicons/core-free-icons/File02Icon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import { HugeiconsIcon } from "@hugeicons/react";

export const chat_models = [
  {
    icon: (
      <HugeiconsIcon
        icon={Sparkles}
        data-icon="sparkles"
        className="text-[16px] text-text-2"
        size={16}
      />
    ),
    title: "Autodetect",
    key: "auto",
  },
  {
    icon: (
      <HugeiconsIcon
        icon={Code}
        data-icon="code"
        className="text-[16px] text-text-2"
        size={16}
      />
    ),
    title: "Chat Codebase",
    key: "codebase",
  },
  {
    icon: (
      <HugeiconsIcon
        icon={Book}
        data-icon="book"
        className="text-[16px] text-text-2"
        size={16}
      />
    ),
    title: "Context",
    key: "context",
  },
  {
    icon: (
      <HugeiconsIcon
        icon={FileText}
        data-icon="file-text"
        size={16}
        strokeWidth={1.75}
        className="text-text-2"
      />
    ),
    title: "Spec",
    key: "spec",
  },
  {
    icon: (
      <HugeiconsIcon
        icon={FileText}
        data-icon="file-text"
        size={16}
        strokeWidth={1.75}
        className="text-text-2"
      />
    ),
    title: "Planner",
    key: "planner",
  },
] as const;

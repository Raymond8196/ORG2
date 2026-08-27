import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Ban from "@hugeicons/core-free-icons/BanIcon";
import XCircle from "@hugeicons/core-free-icons/CancelCircleIcon";
import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import FilePen from "@hugeicons/core-free-icons/FilePenIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import Wrench from "@hugeicons/core-free-icons/Wrench01Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export interface SessionFileChange {
  path: string;
  tool: string;
  count: number;
}

export interface AgentMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_call_id: string | null;
  tool_input: string | null;
  tool_output: string | null;
  model: string | null;
  sequence: number;
  created_at: string;
}

export type SessionFilesCache = Map<string, SessionFileChange[]>;

export interface SessionRun {
  effectiveId: string;
  role: string;
  runNumber: number;
  status: string;
  isActive: boolean;
  session_id: string;
}

export interface StatusStyle {
  icon: IconSvgElement;
  iconClass: string;
  badgeClass: string;
}

export const STATUS_STYLES: Record<string, StatusStyle> = {
  running: {
    icon: Loader2,
    iconClass: "text-primary-6 animate-spin",
    badgeClass: "bg-primary-1 text-primary-6",
  },
  completed: {
    icon: CheckCircle2,
    iconClass: "text-success-6",
    badgeClass: "bg-success-1 text-success-6",
  },
  failed: {
    icon: XCircle,
    iconClass: "text-danger-6",
    badgeClass: "bg-danger-1 text-danger-6",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-danger-6",
    badgeClass: "bg-danger-1 text-danger-6",
  },
  cancelled: {
    icon: Ban,
    iconClass: "text-text-4",
    badgeClass: "bg-fill-2 text-text-3",
  },
};

const DEFAULT_STATUS_STYLE: StatusStyle = {
  icon: Loader2,
  iconClass: "text-text-4",
  badgeClass: "bg-fill-2 text-text-3",
};

export function getStatusStyle(status: string): StatusStyle {
  return STATUS_STYLES[status] ?? DEFAULT_STATUS_STYLE;
}

export const TERMINAL_STATUS = new Set([
  "completed",
  "failed",
  "error",
  "cancelled",
]);

export const STATUS_I18N_KEYS: Record<string, string> = {
  running: "workItems.agentWorkflow.statusRunning",
  completed: "workItems.agentWorkflow.statusCompleted",
  failed: "workItems.agentWorkflow.statusFailed",
  error: "workItems.agentWorkflow.statusFailed",
  cancelled: "workItems.agentWorkflow.statusCancelled",
};

export const TOOL_LABEL_I18N_KEYS: Record<string, string> = {
  edit_file: "workItems.toolLabels.edit",
  apply_patch: "workItems.toolLabels.patch",
};

export const TOOL_ICONS: Record<string, IconSvgElement> = {
  edit_file: FilePen,
  apply_patch: Wrench,
};

import { Network } from "lucide-react";
import React, { memo, useMemo } from "react";

import type { ExecTargetWire } from "@src/api/tauri/agent/session";
import {
  buildRemoteTargetDisplay,
  remoteTargetFromExecTarget,
} from "@src/features/SessionCreator/remoteTargetDisplay";

interface RemoteTargetPillProps {
  execTarget?: ExecTargetWire;
  workspacePath?: string | null;
}

const RemoteTargetPill: React.FC<RemoteTargetPillProps> = memo(
  ({ execTarget, workspacePath }) => {
    const display = useMemo(() => {
      const remoteTarget = remoteTargetFromExecTarget(execTarget);
      if (!remoteTarget) return null;
      return buildRemoteTargetDisplay({
        ...remoteTarget,
        workspacePath,
      });
    }, [execTarget, workspacePath]);

    if (!display) return null;

    return (
      <div
        data-testid="remote-target-pill"
        title={display.title}
        className="flex h-[28px] min-w-0 max-w-[360px] items-center gap-2 rounded-full px-3 text-[12px] font-medium text-text-1 transition-colors hover:bg-fill-2"
      >
        <Network size={14} strokeWidth={1.75} className="shrink-0" />
        <span className="min-w-0 truncate">{display.hostLabel}</span>
        {display.workspaceLabel && (
          <>
            <span className="shrink-0 text-text-4">·</span>
            <span className="min-w-0 truncate text-text-2">
              {display.workspaceLabel}
            </span>
          </>
        )}
      </div>
    );
  }
);

RemoteTargetPill.displayName = "RemoteTargetPill";

export default RemoteTargetPill;

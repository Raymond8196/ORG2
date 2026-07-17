import React, { memo } from "react";

import type { Session } from "@src/store/session";
import { resolveSessionRowIconPresentation } from "@src/util/session/sessionSidebarRow";

interface SessionIdentityIconProps {
  session: Session | null | undefined;
  sessionId: string;
  isSelected?: boolean;
  className?: string;
}

export function resolveSessionIdentityIconColorClass(
  isSelected: boolean,
  isMonochromeBrandIcon: boolean
): string {
  if (!isSelected) return "text-text-2";
  return isMonochromeBrandIcon ? "text-text-1" : "text-primary-6";
}

/** The canonical session icon treatment used by Chat Panel session tabs. */
const SessionIdentityIcon: React.FC<SessionIdentityIconProps> = memo(
  ({ session, sessionId, isSelected = true, className = "" }) => {
    const { Icon, isMonochromeBrandIcon } = resolveSessionRowIconPresentation(
      session ?? sessionId
    );
    const colorClass = resolveSessionIdentityIconColorClass(
      isSelected,
      isMonochromeBrandIcon
    );

    return React.createElement(Icon, {
      size: 16,
      strokeWidth: 2,
      className: `shrink-0 ${colorClass} ${className}`.trim(),
      "aria-hidden": true,
    });
  }
);

SessionIdentityIcon.displayName = "SessionIdentityIcon";

export default SessionIdentityIcon;

import { forwardRef } from "react";
import type { SVGProps } from "react";

import McpLogoSvg from "./mcp.svg";

interface McpLogoIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
}

/**
 * Model Context Protocol logo (Wikimedia) — matches Lucide icon usage in toolbars.
 */
export const McpLogoIcon = forwardRef<SVGSVGElement, McpLogoIconProps>(
  ({ size = 24, className, ...rest }, ref) => (
    <McpLogoSvg
      ref={ref}
      width={size}
      height={size}
      className={className}
      aria-hidden
      {...rest}
    />
  )
);

McpLogoIcon.displayName = "McpLogoIcon";

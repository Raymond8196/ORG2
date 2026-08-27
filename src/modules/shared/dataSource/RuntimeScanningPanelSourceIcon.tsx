/**
 * RuntimeScanningPanelSourceIcon
 *
 * Icon-with-fallback used in RuntimeScanningPanel's "source" column: the
 * detected app/CLI's model icon, or a generic terminal glyph when none is
 * registered.
 */
import Terminal from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { ExternalCliSourceProbe } from "@src/api/tauri/externalHistory";
import ModelIcon, { type IconProvider } from "@src/components/ModelIcon";

const RuntimeScanningPanelSourceIcon: React.FC<{
  probe: ExternalCliSourceProbe;
}> = ({ probe }) => (
  <ModelIcon
    provider={probe.iconId as IconProvider}
    size={16}
    fallback={
      <HugeiconsIcon
        icon={Terminal}
        data-icon="terminal"
        size={16}
        className="text-text-3"
      />
    }
  />
);

export default RuntimeScanningPanelSourceIcon;

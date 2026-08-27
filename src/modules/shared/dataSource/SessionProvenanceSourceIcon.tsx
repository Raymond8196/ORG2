import Terminal from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import ModelIcon, { type IconProvider } from "@src/components/ModelIcon";

interface SessionProvenanceSourceIconProps {
  iconId: IconProvider;
}

const SessionProvenanceSourceIcon: React.FC<
  SessionProvenanceSourceIconProps
> = ({ iconId }) => (
  <ModelIcon
    provider={iconId}
    size={16}
    fallback={
      <HugeiconsIcon icon={Terminal} size={16} className="text-text-3" />
    }
  />
);

export default SessionProvenanceSourceIcon;

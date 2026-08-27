import Check from "@hugeicons/core-free-icons/Tick01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import { DROPDOWN_ITEM } from "./tokens";

interface DropdownSelectedCheckProps {
  className?: string;
}

const DropdownSelectedCheck: React.FC<DropdownSelectedCheckProps> = ({
  className = "",
}) => (
  <HugeiconsIcon
    icon={Check}
    size={DROPDOWN_ITEM.iconSize}
    strokeWidth={2.25}
    className={["shrink-0 text-primary-6", className].filter(Boolean).join(" ")}
  />
);

export default DropdownSelectedCheck;

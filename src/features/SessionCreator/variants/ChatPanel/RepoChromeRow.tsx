import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@src/hooks/logger";
import type { CreatorRepoChromePosition } from "@src/store/session";
import {
  type NativeMenuItemOptions,
  popupNativeMenu,
} from "@src/util/platform/tauri/nativeMenuPopup";

import { REPO_CHROME_POSITION_CLASS } from "./repoChromeLayout";

const log = createLogger("RepoChromeRow");

export interface RepoChromeRowProps {
  children: React.ReactNode;
  position: CreatorRepoChromePosition;
  onPositionChange: (position: CreatorRepoChromePosition) => void;
}

/** Repository controls row with a native Up/Down secondary-click menu. */
export const RepoChromeRow: React.FC<RepoChromeRowProps> = ({
  children,
  position,
  onPositionChange,
}) => {
  const { t } = useTranslation("sessions");
  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      void popupNativeMenu({
        source: "session-creator-repo-chrome",
        buildItems: () => {
          const items: NativeMenuItemOptions[] = [
            {
              text: t("creator.repoChromePosition.up"),
              checked: position === "top",
              action: () => onPositionChange("top"),
            },
            {
              text: t("creator.repoChromePosition.down"),
              checked: position === "bottom",
              action: () => onPositionChange("bottom"),
            },
          ];
          return items;
        },
      }).catch((error) => {
        log.error("Failed to show repository chrome context menu:", error);
      });
    },
    [onPositionChange, position, t]
  );

  return (
    <div
      className={`session-creator-chat-panel-fullscreen-repo-row px-1 ${REPO_CHROME_POSITION_CLASS[position]}`}
      data-testid="session-creator-repo-chrome"
      onContextMenu={handleContextMenu}
    >
      {children}
    </div>
  );
};

export default RepoChromeRow;

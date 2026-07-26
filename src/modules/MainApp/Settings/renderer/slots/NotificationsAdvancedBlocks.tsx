import {
  SECTION_ACTION_GAP_CLASSES,
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { useAtomValue } from "jotai";
import { Play } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  checkNotificationPermission,
  playNotificationSound,
  sendTestNotification,
  unlockNotificationSound,
} from "@src/api/services/notification";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import Select from "@src/components/Select";
import Slider from "@src/components/Slider";
import Switch from "@src/components/Switch";
import {
  NOTIFICATION_SOUND_PRESETS,
  normalizeNotificationSoundPreset,
} from "@src/config/notificationSounds";
import type { NotificationSoundPreset } from "@src/config/notificationSounds";
import { createLogger } from "@src/hooks/logger";
import { NAV_BUTTON_PROPS } from "@src/modules/MainApp/Settings/config";
import { useSetting } from "@src/store/settings";
import { notificationSettingsAtom } from "@src/store/ui/notificationAtom";
import { isMacOS } from "@src/util/platform/tauri";

import NotificationFocusBlocks from "./NotificationFocusBlocks";

const log = createLogger("Notifications");

interface NotificationCategoryConfig {
  key:
    | "taskCompletion"
    | "agentApproval"
    | "errors"
    | "sessionStatus"
    | "gitOperations";
  labelKey: string;
  critical: boolean;
}

const NOTIFICATION_CATEGORIES: NotificationCategoryConfig[] = [
  {
    key: "taskCompletion",
    labelKey: "notifications.taskCompletion",
    critical: false,
  },
  {
    key: "agentApproval",
    labelKey: "notifications.agentApproval",
    critical: true,
  },
  {
    key: "errors",
    labelKey: "notifications.errors",
    critical: true,
  },
  {
    key: "sessionStatus",
    labelKey: "notifications.sessionStatus",
    critical: false,
  },
  {
    key: "gitOperations",
    labelKey: "notifications.gitOperations",
    critical: false,
  },
];

const NotificationsAdvancedBlocks: React.FC = () => {
  const { t } = useTranslation("settings");
  const notificationSettings = useAtomValue(notificationSettingsAtom);
  const [enabled] = useSetting("notifications.enabled");
  const [soundEnabled, setSoundEnabled] = useSetting(
    "notifications.completionSound"
  );
  const [soundPreset, setSoundPreset] = useSetting("notifications.soundPreset");
  const [systemNotificationEnabled, setSystemNotificationEnabled] = useSetting(
    "notifications.systemNotificationEnabled"
  );
  const [dockBadgeEnabled, setDockBadgeEnabled] = useSetting(
    "notifications.dockBadgeEnabled"
  );
  const [soundVolume, setSoundVolume] = useSetting("notifications.soundVolume");
  const [criticalOnly] = useSetting("notifications.criticalOnly");
  const [taskCompletion, setTaskCompletion] = useSetting(
    "notifications.categories.taskCompletion"
  );
  const [agentApproval, setAgentApproval] = useSetting(
    "notifications.categories.agentApproval"
  );
  const [errors, setErrors] = useSetting("notifications.categories.errors");
  const [sessionStatus, setSessionStatus] = useSetting(
    "notifications.categories.sessionStatus"
  );
  const [gitOperations, setGitOperations] = useSetting(
    "notifications.categories.gitOperations"
  );

  const [permissionStatus, setPermissionStatus] = useState<string>("unknown");
  const [isTesting, setIsTesting] = useState(false);
  const soundPresetOptions = useMemo(
    () =>
      NOTIFICATION_SOUND_PRESETS.map((preset) => ({
        value: preset,
        label: t(`notifications.soundPresets.${preset}`),
      })),
    [t]
  );

  useEffect(() => {
    let cancelled = false;
    checkNotificationPermission().then((status) => {
      if (!cancelled) {
        setPermissionStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTestNotification = async () => {
    setIsTesting(true);
    try {
      const success = await sendTestNotification(notificationSettings);
      if (success) {
        Message.success(t("notifications.test.sent"));
      } else {
        Message.warning(t("notifications.test.permissionWarning"));
      }
    } catch {
      Message.error(t("notifications.test.sendFailed"));
    } finally {
      setIsTesting(false);
    }
  };

  const handleToggleDockBadge = async () => {
    const newEnabled = !dockBadgeEnabled;
    setDockBadgeEnabled(newEnabled);
    if (!newEnabled) {
      try {
        await invoke("clear_dock_badge");
      } catch (error) {
        log.error("[Notifications] Failed to clear badge:", error);
      }
    }
  };

  const handleVolumeChange: (value: number | [number, number]) => void = (
    value
  ) => {
    const nextVolume = Array.isArray(value) ? value[0] : value;
    setSoundVolume(nextVolume);
  };

  const handleSoundEnabledChange = () => {
    const nextSoundEnabled = !soundEnabled;
    setSoundEnabled(nextSoundEnabled);
    if (nextSoundEnabled) {
      void unlockNotificationSound();
    }
  };

  const handlePreviewSound = async (preset: NotificationSoundPreset) => {
    const played = await playNotificationSound({
      preset,
      volume: soundVolume,
    });
    if (!played && soundVolume > 0) {
      Message.warning(t("notifications.test.soundFailed"));
    }
  };

  const handleSoundPresetChange = (value: unknown) => {
    const nextPreset = normalizeNotificationSoundPreset(value);
    setSoundPreset(nextPreset);
    void handlePreviewSound(nextPreset);
  };

  const categoryValues = {
    taskCompletion,
    agentApproval,
    errors,
    sessionStatus,
    gitOperations,
  };

  const categorySetters = {
    taskCompletion: setTaskCompletion,
    agentApproval: setAgentApproval,
    errors: setErrors,
    sessionStatus: setSessionStatus,
    gitOperations: setGitOperations,
  } as const;

  if (!enabled) {
    return null;
  }

  return (
    <>
      <NotificationFocusBlocks />

      <SectionContainer>
        <SectionRow label={t("notifications.enableSound")}>
          <Switch checked={soundEnabled} onChange={handleSoundEnabledChange} />
        </SectionRow>

        {soundEnabled && (
          <>
            <SectionRow
              label={t("notifications.soundPreset")}
              description={t("notifications.soundPresetDesc")}
              indent
            >
              <div
                className={`${SECTION_ACTION_GAP_CLASSES} w-full flex-wrap`}
                style={SECTION_CONTROL_STYLE}
              >
                <div className="min-w-0 flex-1">
                  <Select
                    value={soundPreset}
                    onChange={handleSoundPresetChange}
                    options={soundPresetOptions}
                    size="default"
                    style={{ width: "100%" }}
                    dataTestId="notification-sound-preset-select"
                  />
                </div>
                <Button
                  size="default"
                  icon={<Play size={14} />}
                  onClick={() => {
                    void handlePreviewSound(soundPreset);
                  }}
                  disabled={soundVolume === 0}
                >
                  {t("notifications.previewSound")}
                </Button>
              </div>
            </SectionRow>
            <SectionRow label={t("notifications.volume")} indent>
              <div className="w-[160px] max-w-full">
                <Slider
                  value={soundVolume}
                  onChange={handleVolumeChange}
                  min={0}
                  max={100}
                  showTooltip={false}
                  noPadding
                />
              </div>
            </SectionRow>
          </>
        )}
      </SectionContainer>

      <SectionContainer>
        {NOTIFICATION_CATEGORIES.map((category) => (
          <SectionRow key={category.key} label={t(category.labelKey)}>
            <Switch
              checked={categoryValues[category.key]}
              disabled={criticalOnly && !category.critical}
              onChange={() =>
                categorySetters[category.key](!categoryValues[category.key])
              }
              ariaLabel={t(category.labelKey)}
            />
          </SectionRow>
        ))}
      </SectionContainer>

      <SectionContainer>
        <SectionRow label={t("notifications.enableSystem")}>
          <Switch
            checked={systemNotificationEnabled}
            onChange={() =>
              setSystemNotificationEnabled(!systemNotificationEnabled)
            }
          />
        </SectionRow>
        {systemNotificationEnabled && (
          <SectionRow
            label={t("notifications.systemPermission")}
            indent
            description={
              permissionStatus === "granted"
                ? t("notifications.notificationsAllowed")
                : permissionStatus === "denied"
                  ? t("notifications.notificationsBlocked")
                  : t("notifications.permissionNotRequested")
            }
          >
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs text-text-1">
                {permissionStatus === "granted"
                  ? t("notifications.granted")
                  : permissionStatus === "denied"
                    ? t("notifications.denied")
                    : t("common:status.unknown")}
              </span>
              {isMacOS() && (
                <Button
                  {...NAV_BUTTON_PROPS}
                  onClick={() => {
                    shellOpen(
                      "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
                    );
                  }}
                >
                  {t("common:actions.configure")}
                </Button>
              )}
            </div>
          </SectionRow>
        )}
      </SectionContainer>

      <SectionContainer>
        <SectionRow label={t("notifications.enableDockBadge")}>
          <Switch checked={dockBadgeEnabled} onChange={handleToggleDockBadge} />
        </SectionRow>
      </SectionContainer>

      <SectionContainer>
        <SectionRow label={t("notifications.testNotification")}>
          <Button
            size="default"
            onClick={handleTestNotification}
            loading={isTesting}
            disabled={permissionStatus !== "granted"}
          >
            {t("notifications.notification")}
          </Button>
        </SectionRow>
      </SectionContainer>
    </>
  );
};

export default NotificationsAdvancedBlocks;

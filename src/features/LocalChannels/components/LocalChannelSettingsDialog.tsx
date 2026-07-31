/**
 * LocalChannelSettingsDialog — rename + topic editing for a local channel
 * (the scope-neutral "Channel settings" surface; the cloud counterpart is
 * `ChannelSettingsDialog` with the extra post-policy select).
 *
 * The form seeds from the target channel at MOUNT (`useState` initializers):
 * the mounting parent KEYS this dialog on open-state + channel id
 * (`localChannelsSection.tsx`), so every open is a fresh mount with a fresh
 * seed — no reset-in-effect (`react-hooks/set-state-in-effect`-safe). It
 * submits through the synchronous `updateLocalChannelAtom` reducer and is
 * NEVER cleared on a failure path — "name taken" surfaces inline exactly
 * like the create dialog.
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import {
  normalizeChannelName,
  normalizeChannelNameInput,
} from "@src/features/Org2Cloud/channels/channelName";
import {
  CHANNEL_NAME_MAX_LENGTH,
  CHANNEL_TOPIC_MAX_LENGTH,
} from "@src/features/Org2Cloud/channels/types";
import {
  type LocalChannel,
  type LocalChannelErrorCode,
  updateLocalChannelAtom,
} from "@src/store/ui/localChannelsAtom";

export interface LocalChannelSettingsDialogProps {
  open: boolean;
  channel: LocalChannel | null;
  onClose: () => void;
}

const LocalChannelSettingsDialog: React.FC<LocalChannelSettingsDialogProps> = ({
  open,
  channel,
  onClose,
}) => {
  const { t } = useTranslation("navigation");
  const updateChannel = useSetAtom(updateLocalChannelAtom);

  // Seeded once per mount — the parent's key makes each open a fresh mount.
  const [name, setName] = useState(() => channel?.name ?? "");
  const [topic, setTopic] = useState(() => channel?.topic ?? "");
  const [errorCode, setErrorCode] = useState<LocalChannelErrorCode | null>(
    null
  );

  const normalizedName = normalizeChannelName(name);
  const canSubmit = open && channel !== null && normalizedName.length > 0;

  const handleSubmit = useCallback(() => {
    if (!channel) return;
    setErrorCode(null);
    // Empty topic string intentionally clears it (0014 update contract).
    const result = updateChannel({ id: channel.id, name, topic });
    if (!result.ok) {
      // The form is intentionally left untouched on every failure path.
      setErrorCode(result.error);
      return;
    }
    onClose();
  }, [channel, updateChannel, name, topic, onClose]);

  const errorMessage =
    errorCode === "nameTaken"
      ? t("cloud.channels.create.nameTaken")
      : errorCode !== null
        ? t("cloud.channels.settings.error")
        : null;

  return (
    <Modal
      visible={open && channel !== null}
      title={t("cloud.channels.settings.title", { name: channel?.name ?? "" })}
      onCancel={onClose}
      footer={null}
      width={480}
    >
      <div
        className="flex flex-col gap-3"
        data-testid="local-channel-settings-dialog"
      >
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-2">
            {t("cloud.channels.create.nameLabel")}
          </label>
          <Input
            value={name}
            onChange={(value) => {
              setName(normalizeChannelNameInput(value));
            }}
            placeholder={t("cloud.channels.create.namePlaceholder")}
            maxLength={CHANNEL_NAME_MAX_LENGTH}
            prefix={<span className="text-[13px] text-text-3">#</span>}
            suffix={
              <span className="text-[11px] tabular-nums text-text-4">
                {name.length}/{CHANNEL_NAME_MAX_LENGTH}
              </span>
            }
            data-testid="local-channel-settings-name"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-2">
            {t("cloud.channels.create.topicLabel")}{" "}
            <span className="font-normal text-text-4">
              {t("cloud.channels.create.topicOptional")}
            </span>
          </label>
          <Input
            value={topic}
            onChange={setTopic}
            placeholder={t("cloud.channels.create.topicPlaceholder")}
            maxLength={CHANNEL_TOPIC_MAX_LENGTH}
            data-testid="local-channel-settings-topic"
          />
        </div>

        {errorMessage ? (
          <div
            className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
            data-testid="local-channel-settings-error"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            htmlType="button"
            variant="secondary"
            onClick={onClose}
            data-testid="local-channel-settings-cancel"
          >
            {t("cloud.channels.cancel")}
          </Button>
          <Button
            htmlType="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="local-channel-settings-submit"
          >
            {t("cloud.channels.settings.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default LocalChannelSettingsDialog;

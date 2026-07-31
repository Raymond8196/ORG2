/**
 * CreateLocalChannelDialog — Slack-style channel creation for the LOCAL
 * (non-cloud) sidebar scope. Visual/UX parity with the cloud
 * `CreateChannelDialog` minus the cloud-only concepts (no visibility toggle,
 * no member picker, no posting policy): a '#'-adorned live-normalizing name
 * input with an n/80 counter plus an optional topic.
 *
 * Mutations are the synchronous `createLocalChannelAtom` reducer; its typed
 * error result maps onto the same inline error box as the cloud dialog
 * (name-taken / device quota / generic), and the form is NEVER cleared on a
 * failure path.
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

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
  createLocalChannelAtom,
} from "@src/store/ui/localChannelsAtom";

export interface CreateLocalChannelDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (channel: LocalChannel) => void;
}

const CreateLocalChannelDialog: React.FC<CreateLocalChannelDialogProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation("navigation");
  const createChannel = useSetAtom(createLocalChannelAtom);

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [errorCode, setErrorCode] = useState<LocalChannelErrorCode | null>(
    null
  );

  const normalizedName = normalizeChannelName(name);
  const canSubmit = open && normalizedName.length > 0;

  const handleClose = useCallback(() => {
    setErrorCode(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    setErrorCode(null);
    const result = createChannel({ name, topic });
    if (!result.ok) {
      // The form is intentionally left untouched on every failure path.
      setErrorCode(result.error);
      return;
    }
    onCreated?.(result.channel);
    setName("");
    setTopic("");
    onClose();
  }, [createChannel, name, topic, onCreated, onClose]);

  let errorMessage: string | null = null;
  if (errorCode === "nameTaken") {
    errorMessage = t("cloud.channels.create.nameTaken");
  } else if (errorCode === "quota") {
    errorMessage = t("cloud.channels.local.quotaExceeded");
  } else if (errorCode === "invalid") {
    errorMessage = t("cloud.channels.create.error");
  }

  return (
    <Modal
      visible={open}
      title={t("cloud.channels.create.title")}
      onCancel={handleClose}
      onOk={handleSubmit}
      cancelText={t("cloud.channels.cancel")}
      okText={t("cloud.channels.create.submit")}
      cancelButtonProps={{
        dataTestId: "local-channel-create-cancel",
      }}
      okButtonProps={{
        loading: false,
        disabled: !canSubmit,
        dataTestId: "local-channel-create-submit",
      }}
      width={480}
    >
      <div
        className="flex flex-col gap-3"
        data-testid="local-channel-create-dialog"
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
            data-testid="local-channel-create-name"
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
            data-testid="local-channel-create-topic"
          />
        </div>

        {errorMessage ? (
          <div
            className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
            data-testid="local-channel-create-error"
          >
            {errorMessage}
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

export default CreateLocalChannelDialog;

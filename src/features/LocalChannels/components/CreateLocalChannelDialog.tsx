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

import Button from "@src/components/Button";
import { normalizeChannelName } from "@src/features/Org2Cloud/channels/channelName";
import {
  ChannelDialogErrorNotice,
  ChannelNameField,
  ChannelTopicField,
} from "@src/features/Org2Cloud/channels/components/ChannelFormFields";
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
      footer={null}
      width={480}
    >
      <div
        className="flex flex-col gap-3"
        data-testid="local-channel-create-dialog"
      >
        <ChannelNameField
          value={name}
          onChange={setName}
          testId="local-channel-create-name"
        />

        <ChannelTopicField
          value={topic}
          onChange={setTopic}
          testId="local-channel-create-topic"
        />

        <ChannelDialogErrorNotice
          message={errorMessage}
          testId="local-channel-create-error"
        />

        <div className="flex items-center justify-end gap-2">
          <Button
            htmlType="button"
            variant="secondary"
            onClick={handleClose}
            data-testid="local-channel-create-cancel"
          >
            {t("cloud.channels.cancel")}
          </Button>
          <Button
            htmlType="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="local-channel-create-submit"
          >
            {t("cloud.channels.create.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateLocalChannelDialog;

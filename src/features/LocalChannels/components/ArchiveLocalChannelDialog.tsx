/**
 * ArchiveLocalChannelDialog — light confirm for archiving a local channel,
 * mirroring the cloud `ArchiveChannelDialog` tone. Archiving is soft
 * (`archivedAt`): the channel moves to the collapsed "Archived" subgroup,
 * its name stays reserved, and it can be unarchived later. The body copy is
 * local-scoped ("your sidebar" — there is no "everyone" here).
 *
 * A stale error must never greet the next open — the mounting parent KEYS
 * this dialog on open-state + channel id (`localChannelsSection.tsx`), so a
 * fresh mount resets it without any reset-in-effect
 * (`react-hooks/set-state-in-effect`-safe).
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  type LocalChannel,
  archiveLocalChannelAtom,
} from "@src/store/ui/localChannelsAtom";

export interface ArchiveLocalChannelDialogProps {
  open: boolean;
  channel: LocalChannel | null;
  onClose: () => void;
}

const ArchiveLocalChannelDialog: React.FC<ArchiveLocalChannelDialogProps> = ({
  open,
  channel,
  onClose,
}) => {
  const { t } = useTranslation("navigation");
  const archiveChannel = useSetAtom(archiveLocalChannelAtom);
  const [failed, setFailed] = useState(false);

  const handleArchive = useCallback(() => {
    if (!channel) return;
    setFailed(false);
    const result = archiveChannel(channel.id);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    onClose();
  }, [archiveChannel, channel, onClose]);

  return (
    <Modal
      visible={open && channel !== null}
      title={t("cloud.channels.archive.title", { name: channel?.name ?? "" })}
      onCancel={onClose}
      footer={null}
      width={440}
    >
      <div
        className="flex flex-col gap-3"
        data-testid="local-channel-archive-dialog"
      >
        <div className="text-[12px] text-text-2">
          {t("cloud.channels.local.archiveBody")}
        </div>

        {failed ? (
          <div
            className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
            data-testid="local-channel-archive-error"
          >
            {t("cloud.channels.archive.error")}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            htmlType="button"
            variant="secondary"
            onClick={onClose}
            data-testid="local-channel-archive-cancel"
          >
            {t("cloud.channels.cancel")}
          </Button>
          <Button
            htmlType="button"
            variant="primary"
            disabled={!channel}
            onClick={handleArchive}
            data-testid="local-channel-archive-confirm"
          >
            {t("cloud.channels.archive.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ArchiveLocalChannelDialog;

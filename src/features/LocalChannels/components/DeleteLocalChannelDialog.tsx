/**
 * DeleteLocalChannelDialog — destructive confirm for the HARD local-channel
 * delete (irreversible; the row is removed from this machine's store).
 * Mirrors the cloud `DeleteChannelDialog`: the danger action stays disabled
 * until the acknowledgement checkbox is checked.
 *
 * The acknowledgement must be per-open and per-channel — the mounting parent
 * guarantees that by KEYING this dialog on open-state + channel id
 * (`localChannelsSection.tsx`), so a fresh mount resets the checkbox without
 * any reset-in-effect (`react-hooks/set-state-in-effect`-safe).
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useSetAtom } from "jotai";
import { TriangleAlert } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Checkbox from "@src/components/Checkbox";
import {
  type LocalChannel,
  deleteLocalChannelAtom,
} from "@src/store/ui/localChannelsAtom";

export interface DeleteLocalChannelDialogProps {
  open: boolean;
  channel: LocalChannel | null;
  onClose: () => void;
  onDeleted?: () => void;
}

const DeleteLocalChannelDialog: React.FC<DeleteLocalChannelDialogProps> = ({
  open,
  channel,
  onClose,
  onDeleted,
}) => {
  const { t } = useTranslation("navigation");
  const deleteChannel = useSetAtom(deleteLocalChannelAtom);
  const [acknowledged, setAcknowledged] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleDelete = useCallback(() => {
    if (!channel || !acknowledged) return;
    setFailed(false);
    const result = deleteChannel(channel.id);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    onDeleted?.();
    onClose();
  }, [channel, acknowledged, deleteChannel, onDeleted, onClose]);

  return (
    <Modal
      visible={open && channel !== null}
      title={t("cloud.channels.delete.title", { name: channel?.name ?? "" })}
      onCancel={onClose}
      footer={null}
      width={440}
    >
      <div
        className="flex flex-col gap-3"
        data-testid="local-channel-delete-dialog"
      >
        <div className="flex items-start gap-2 rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>{t("cloud.channels.local.deleteWarning")}</span>
        </div>

        <div data-testid="local-channel-delete-acknowledge">
          <Checkbox
            size="small"
            checked={acknowledged}
            onChange={(checked) => setAcknowledged(checked)}
          >
            {t("cloud.channels.delete.acknowledge")}
          </Checkbox>
        </div>

        {failed ? (
          <div
            className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
            data-testid="local-channel-delete-error"
          >
            {t("cloud.channels.delete.error")}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            htmlType="button"
            variant="secondary"
            onClick={onClose}
            data-testid="local-channel-delete-cancel"
          >
            {t("cloud.channels.cancel")}
          </Button>
          <Button
            htmlType="button"
            variant="danger"
            disabled={!acknowledged || !channel}
            onClick={handleDelete}
            data-testid="local-channel-delete-confirm"
          >
            {t("cloud.channels.delete.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeleteLocalChannelDialog;

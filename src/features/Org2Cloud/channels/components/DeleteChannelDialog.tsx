/**
 * DeleteChannelDialog — Slack-style destructive confirm for the HARD channel
 * delete (0012 `cloud_delete_channel`, org owner/admin only, irreversible).
 * The danger action stays disabled until the acknowledgement checkbox is
 * checked; `ORG2_ADMIN_REQUIRED` surfaces as a dedicated inline error. On
 * success bumps the per-org channels version so listings refetch.
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useSetAtom } from "jotai";
import { TriangleAlert } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Checkbox from "@src/components/Checkbox";

import { bumpOrg2CloudChannelsVersionAtom } from "../channelsAtom";
import { deleteCloudChannel, isOrg2ChannelsErrorCode } from "../channelsClient";
import type { CloudChannel } from "../types";
import { useFreshChannelAccessToken } from "./useChannelDialogAccess";

type DeleteErrorKind = "adminRequired" | "generic";

export interface DeleteChannelDialogProps {
  open: boolean;
  orgId: string | null;
  channel: CloudChannel | null;
  onClose: () => void;
  onDeleted?: () => void;
}

const DeleteChannelDialog: React.FC<DeleteChannelDialogProps> = ({
  open,
  orgId,
  channel,
  onClose,
  onDeleted,
}) => {
  const { t } = useTranslation("navigation");
  const bumpChannelsVersion = useSetAtom(bumpOrg2CloudChannelsVersionAtom);
  const getFreshAccessToken = useFreshChannelAccessToken();
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorKind, setErrorKind] = useState<DeleteErrorKind | null>(null);

  // The acknowledgement is per-open and per-channel — never carried over.
  useEffect(() => {
    setAcknowledged(false);
    setErrorKind(null);
  }, [open, channel?.id]);

  const handleDelete = useCallback(async () => {
    if (!orgId || !channel || !acknowledged || deleting) return;
    setDeleting(true);
    setErrorKind(null);
    try {
      const accessToken = await getFreshAccessToken();
      await deleteCloudChannel(accessToken, orgId, channel.id);
      bumpChannelsVersion(orgId);
      onDeleted?.();
      onClose();
    } catch (caught) {
      setErrorKind(
        isOrg2ChannelsErrorCode(caught, "ORG2_ADMIN_REQUIRED")
          ? "adminRequired"
          : "generic"
      );
    } finally {
      setDeleting(false);
    }
  }, [
    orgId,
    channel,
    acknowledged,
    deleting,
    getFreshAccessToken,
    bumpChannelsVersion,
    onDeleted,
    onClose,
  ]);

  return (
    <Modal
      visible={open && channel !== null}
      title={t("cloud.channels.delete.title", { name: channel?.name ?? "" })}
      onCancel={onClose}
      footer={null}
      width={440}
    >
      <div className="flex flex-col gap-3" data-testid="channel-delete-dialog">
        <div className="flex items-start gap-2 rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>{t("cloud.channels.delete.warning")}</span>
        </div>

        <div data-testid="channel-delete-acknowledge">
          <Checkbox
            size="small"
            checked={acknowledged}
            onChange={(checked) => setAcknowledged(checked)}
          >
            {t("cloud.channels.delete.acknowledge")}
          </Checkbox>
        </div>

        {errorKind ? (
          <div
            className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
            data-testid="channel-delete-error"
          >
            {errorKind === "adminRequired"
              ? t("cloud.channels.delete.adminRequired")
              : t("cloud.channels.delete.error")}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            htmlType="button"
            variant="secondary"
            onClick={onClose}
            data-testid="channel-delete-cancel"
          >
            {t("cloud.channels.cancel")}
          </Button>
          <Button
            htmlType="button"
            variant="danger"
            loading={deleting}
            disabled={!acknowledged || deleting || !channel || !orgId}
            onClick={() => void handleDelete()}
            data-testid="channel-delete-confirm"
          >
            {t("cloud.channels.delete.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeleteChannelDialog;

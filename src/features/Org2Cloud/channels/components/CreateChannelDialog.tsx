/**
 * CreateChannelDialog — Slack-style channel creation for a managed cloud org
 * (0014 control plane).
 *
 * Name input live-normalizes via `normalizeChannelNameInput` (lowercase,
 * leading '#' stripped, spaces → hyphens) behind a literal '#' adornment;
 * visibility is a public/private radio-card pair; the private branch shows a
 * member picker off the shared roster coordinator (creator excluded — the
 * server adds them as manager); "who can post" maps to `postPolicy`. On
 * success bumps the per-org channels version so every listing refetches.
 * Failures NEVER clear the form — the inline error distinguishes name-taken
 * (`ORG2_CONFLICT`) and org quota (`ORG2_QUOTA_EXCEEDED`) from the generic
 * case.
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useAtomValue, useSetAtom } from "jotai";
import { Hash, Lock } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Checkbox from "@src/components/Checkbox";
import Input from "@src/components/Input";
import Select from "@src/components/Select";

import { org2CloudAuthAtom } from "../../org2CloudAuthAtom";
import {
  normalizeChannelName,
  normalizeChannelNameInput,
  validateChannelName,
} from "../channelName";
import { bumpOrg2CloudChannelsVersionAtom } from "../channelsAtom";
import { createCloudChannel, isOrg2ChannelsErrorCode } from "../channelsClient";
import type {
  CloudChannel,
  CloudChannelPostPolicy,
  CloudChannelVisibility,
} from "../types";
import {
  CHANNEL_ADD_MEMBERS_MAX_PER_CALL,
  CHANNEL_NAME_MAX_LENGTH,
  CHANNEL_TOPIC_MAX_LENGTH,
} from "../types";
import {
  useActiveOrgMembers,
  useFreshChannelAccessToken,
} from "./useChannelDialogAccess";

/** Above the modal wrapper (9999) so the select panel is not swallowed. */
const MODAL_SELECT_Z_INDEX = 10_000;

type CreateChannelErrorKind = "nameTaken" | "quotaExceeded" | "generic";

export interface CreateChannelDialogProps {
  open: boolean;
  orgId: string | null;
  onClose: () => void;
  onCreated?: (channel: CloudChannel) => void;
}

const CreateChannelDialog: React.FC<CreateChannelDialogProps> = ({
  open,
  orgId,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation("navigation");
  const currentUserId = useAtomValue(org2CloudAuthAtom)?.userId ?? null;
  const bumpChannelsVersion = useSetAtom(bumpOrg2CloudChannelsVersionAtom);
  const getFreshAccessToken = useFreshChannelAccessToken();

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<CloudChannelVisibility>("org");
  const [postPolicy, setPostPolicy] =
    useState<CloudChannelPostPolicy>("everyone");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<CreateChannelErrorKind | null>(
    null
  );

  const roster = useActiveOrgMembers(orgId, open && visibility === "private");
  // The creator is added as manager server-side; never offer them as a pick.
  const selectableMembers = useMemo(
    () => roster.members.filter((member) => member.userId !== currentUserId),
    [roster.members, currentUserId]
  );

  const normalizedName = normalizeChannelName(name);
  const canSubmit =
    open && orgId !== null && normalizedName.length > 0 && !submitting;

  const handleToggleMember = useCallback((userId: string) => {
    setSelectedMemberIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  }, []);

  const resetForm = useCallback(() => {
    setName("");
    setTopic("");
    setVisibility("org");
    setPostPolicy("everyone");
    setSelectedMemberIds([]);
    setErrorKind(null);
  }, []);

  const handleClose = useCallback(() => {
    setErrorKind(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (!orgId || submitting) return;
    const submittedName = normalizeChannelName(name);
    if (validateChannelName(submittedName) !== null) return;
    setSubmitting(true);
    setErrorKind(null);
    try {
      const accessToken = await getFreshAccessToken();
      const trimmedTopic = topic.trim();
      const channel = await createCloudChannel(accessToken, orgId, {
        name: submittedName,
        topic: trimmedTopic.length > 0 ? trimmedTopic : undefined,
        visibility,
        postPolicy,
        memberUserIds:
          visibility === "private" && selectedMemberIds.length > 0
            ? selectedMemberIds
            : undefined,
      });
      bumpChannelsVersion(orgId);
      onCreated?.(channel);
      resetForm();
      onClose();
    } catch (caught) {
      // The form is intentionally left untouched on every failure path.
      if (isOrg2ChannelsErrorCode(caught, "ORG2_CONFLICT")) {
        setErrorKind("nameTaken");
      } else if (isOrg2ChannelsErrorCode(caught, "ORG2_QUOTA_EXCEEDED")) {
        setErrorKind("quotaExceeded");
      } else {
        setErrorKind("generic");
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    orgId,
    submitting,
    name,
    topic,
    visibility,
    postPolicy,
    selectedMemberIds,
    getFreshAccessToken,
    bumpChannelsVersion,
    onCreated,
    resetForm,
    onClose,
  ]);

  const postPolicyOptions = useMemo(
    () => [
      {
        value: "everyone",
        label: t("cloud.channels.create.postPolicyEveryone"),
        dataTestId: "channel-create-post-policy-everyone",
      },
      {
        value: "managers",
        label: t("cloud.channels.create.postPolicyManagers"),
        dataTestId: "channel-create-post-policy-managers",
      },
    ],
    [t]
  );

  let errorMessage: string | null = null;
  if (errorKind === "nameTaken") {
    errorMessage = t("cloud.channels.create.nameTaken");
  } else if (errorKind === "quotaExceeded") {
    errorMessage = t("cloud.channels.create.quotaExceeded");
  } else if (errorKind === "generic") {
    errorMessage = t("cloud.channels.create.error");
  }

  const visibilityCardClass = (selected: boolean) =>
    `flex flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition-colors ${
      selected
        ? "border-primary-6 bg-fill-1"
        : "border-border-2 hover:bg-surface-hover"
    }`;

  return (
    <Modal
      visible={open}
      title={t("cloud.channels.create.title")}
      onCancel={handleClose}
      footer={null}
      width={480}
    >
      <div
        className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto"
        data-testid="channel-create-dialog"
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
            data-testid="channel-create-name"
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
            data-testid="channel-create-topic"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-2">
            {t("cloud.channels.create.visibilityLabel")}
          </span>
          <div
            role="radiogroup"
            aria-label={t("cloud.channels.create.visibilityLabel")}
            className="grid grid-cols-2 gap-2"
          >
            <button
              type="button"
              role="radio"
              aria-checked={visibility === "org"}
              onClick={() => setVisibility("org")}
              className={visibilityCardClass(visibility === "org")}
              data-testid="channel-create-visibility-org"
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-1">
                <Hash size={14} className="text-text-3" />
                {t("cloud.channels.create.publicTitle")}
              </span>
              <span className="text-[11px] text-text-3">
                {t("cloud.channels.create.publicDesc")}
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={visibility === "private"}
              onClick={() => setVisibility("private")}
              className={visibilityCardClass(visibility === "private")}
              data-testid="channel-create-visibility-private"
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-1">
                <Lock size={14} className="text-text-3" />
                {t("cloud.channels.create.privateTitle")}
              </span>
              <span className="text-[11px] text-text-3">
                {t("cloud.channels.create.privateDesc")}
              </span>
            </button>
          </div>
        </div>

        {visibility === "private" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-text-2">
              {t("cloud.channels.create.membersLabel")}
            </span>
            <span className="text-[11px] text-text-3">
              {t("cloud.channels.create.membersHint")}
            </span>
            {roster.loading ? (
              <div
                className="text-[11px] text-text-3"
                data-testid="channel-create-members-loading"
              >
                {t("cloud.channels.create.membersLoading")}
              </div>
            ) : selectableMembers.length === 0 ? (
              <div className="text-[11px] text-text-3">
                {t("cloud.channels.create.membersEmpty")}
              </div>
            ) : (
              <div className="flex max-h-40 flex-col divide-y divide-border-2 overflow-y-auto rounded-lg border border-border-2">
                {selectableMembers.map((member) => {
                  const checked = selectedMemberIds.includes(member.userId);
                  return (
                    <div
                      key={member.userId}
                      data-testid={`channel-create-member-${member.userId}`}
                    >
                      <Checkbox
                        size="small"
                        className="w-full px-2.5 py-1.5 hover:bg-surface-hover"
                        checked={checked}
                        disabled={
                          !checked &&
                          selectedMemberIds.length >=
                            CHANNEL_ADD_MEMBERS_MAX_PER_CALL
                        }
                        onChange={() => handleToggleMember(member.userId)}
                      >
                        {member.displayName ?? member.userId}
                      </Checkbox>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-2">
            {t("cloud.channels.create.postPolicyLabel")}
          </span>
          <Select
            value={postPolicy}
            options={postPolicyOptions}
            onChange={(value) => setPostPolicy(value as CloudChannelPostPolicy)}
            size="small"
            panelZIndex={MODAL_SELECT_Z_INDEX}
            dataTestId="channel-create-post-policy"
          />
        </div>

        {errorMessage ? (
          <div
            className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
            data-testid="channel-create-error"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            htmlType="button"
            variant="secondary"
            onClick={handleClose}
            data-testid="channel-create-cancel"
          >
            {t("cloud.channels.cancel")}
          </Button>
          <Button
            htmlType="button"
            variant="primary"
            loading={submitting}
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            data-testid="channel-create-submit"
          >
            {t("cloud.channels.create.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateChannelDialog;

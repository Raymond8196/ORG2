/**
 * CreateChannelDialog — Lark-inspired channel creation for a managed cloud
 * org (0014 control plane).
 *
 * Name input live-normalizes via `normalizeChannelNameInput` (lowercase,
 * leading '#' stripped, spaces → hyphens) behind a literal '#' adornment;
 * visibility is a public/private radio group; the private branch shows a
 * two-pane member picker off the shared roster coordinator (creator excluded
 * — the server adds them as manager); "who can post" maps to `postPolicy`. On
 * success bumps the per-org channels version so every listing refetches.
 * Failures NEVER clear the form — the inline error distinguishes name-taken
 * (`ORG2_CONFLICT`) and org quota (`ORG2_QUOTA_EXCEEDED`) from the generic
 * case.
 */
import Modal from "@/src/scaffold/ModalSystem";
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Avatar from "@src/components/Avatar";
import Checkbox from "@src/components/Checkbox";
import Input from "@src/components/Input";
import Radio from "@src/components/Radio";
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
  const selectedMemberIdSet = useMemo(
    () => new Set(selectedMemberIds),
    [selectedMemberIds]
  );
  const selectedMembers = useMemo(
    () =>
      selectableMembers.filter((member) =>
        selectedMemberIdSet.has(member.userId)
      ),
    [selectableMembers, selectedMemberIdSet]
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

  return (
    <Modal
      visible={open}
      title={t("cloud.channels.create.title")}
      onCancel={handleClose}
      onOk={handleSubmit}
      cancelText={t("cloud.channels.cancel")}
      okText={t("cloud.channels.create.submit")}
      cancelButtonProps={{
        disabled: submitting,
        dataTestId: "channel-create-cancel",
      }}
      okButtonProps={{
        loading: submitting,
        disabled: !canSubmit,
        dataTestId: "channel-create-submit",
      }}
      bodyClassName="p-0"
      width={760}
    >
      <div
        className="flex flex-col gap-5 px-5 py-4"
        data-testid="channel-create-dialog"
      >
        <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-4">
          <label
            htmlFor="channel-create-name"
            className="text-[13px] font-medium text-text-1"
          >
            {t("cloud.channels.create.nameLabel")}
            <span className="ml-0.5 text-danger-6" aria-hidden="true">
              *
            </span>
          </label>
          <Input
            id="channel-create-name"
            required
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

        <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-4">
          <label
            htmlFor="channel-create-topic"
            className="text-[13px] font-medium text-text-1"
          >
            {t("cloud.channels.create.topicLabel")}
          </label>
          <Input
            id="channel-create-topic"
            value={topic}
            onChange={setTopic}
            placeholder={t("cloud.channels.create.topicPlaceholder")}
            maxLength={CHANNEL_TOPIC_MAX_LENGTH}
            data-testid="channel-create-topic"
          />
        </div>

        <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-4">
          <span className="pt-1 text-[13px] font-medium text-text-1">
            {t("cloud.channels.create.visibilityLabel")}
          </span>
          <Radio.Group
            value={visibility}
            onChange={(value) => setVisibility(value as CloudChannelVisibility)}
            size="small"
            className="gap-7"
          >
            <div data-testid="channel-create-visibility-org">
              <Radio value="org">
                <span className="flex flex-col">
                  <span>{t("cloud.channels.create.publicTitle")}</span>
                  <span className="text-[11px] font-normal text-text-3">
                    {t("cloud.channels.create.publicDesc")}
                  </span>
                </span>
              </Radio>
            </div>
            <div data-testid="channel-create-visibility-private">
              <Radio value="private">
                <span className="flex flex-col">
                  <span>{t("cloud.channels.create.privateTitle")}</span>
                  <span className="text-[11px] font-normal text-text-3">
                    {t("cloud.channels.create.privateDesc")}
                  </span>
                </span>
              </Radio>
            </div>
          </Radio.Group>
        </div>

        {visibility === "private" ? (
          <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-4">
            <span className="pt-2 text-[13px] font-medium text-text-1">
              {t("cloud.channels.create.membersLabel")}
            </span>
            <div className="min-w-0">
              <div className="mb-2 text-[11px] text-text-3">
                {t("cloud.channels.create.membersHint")}
              </div>
              <div className="grid h-72 min-h-0 grid-cols-2 overflow-hidden rounded-xl border border-border-2">
                <div className="flex min-w-0 flex-col border-r border-border-2">
                  <div className="border-b border-border-2 px-3 py-2 text-[12px] font-medium text-text-2">
                    {t("cloud.channels.create.membersLabel")}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {roster.loading ? (
                      <div
                        className="px-2 py-1.5 text-[12px] text-text-3"
                        data-testid="channel-create-members-loading"
                      >
                        {t("cloud.channels.create.membersLoading")}
                      </div>
                    ) : selectableMembers.length === 0 ? (
                      <div className="px-2 py-1.5 text-[12px] text-text-3">
                        {t("cloud.channels.create.membersEmpty")}
                      </div>
                    ) : (
                      selectableMembers.map((member) => {
                        const checked = selectedMemberIdSet.has(member.userId);
                        const displayName = member.displayName ?? member.userId;
                        return (
                          <div
                            key={member.userId}
                            data-testid={`channel-create-member-${member.userId}`}
                          >
                            <Checkbox
                              size="small"
                              className="w-full rounded-lg px-2 py-1.5 hover:bg-surface-hover"
                              checked={checked}
                              disabled={
                                !checked &&
                                selectedMemberIds.length >=
                                  CHANNEL_ADD_MEMBERS_MAX_PER_CALL
                              }
                              onChange={() => handleToggleMember(member.userId)}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Avatar size={28}>
                                  {displayName.slice(0, 1).toUpperCase()}
                                </Avatar>
                                <span className="truncate text-[13px] text-text-1">
                                  {displayName}
                                </span>
                              </span>
                            </Checkbox>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 flex-col">
                  <div
                    className="flex items-center gap-1 border-b border-border-2 px-3 py-2 text-[12px] font-medium text-text-2"
                    data-testid="channel-create-selected-count"
                  >
                    <span>{t("cloud.channels.create.membersLabel")}</span>
                    <span className="tabular-nums text-text-3">
                      ({selectedMembers.length})
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {selectedMembers.map((member) => {
                      const displayName = member.displayName ?? member.userId;
                      return (
                        <div
                          key={member.userId}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                          data-testid={`channel-create-selected-member-${member.userId}`}
                        >
                          <Avatar size={28}>
                            {displayName.slice(0, 1).toUpperCase()}
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-text-1">
                            {displayName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-4">
          <span className="text-[13px] font-medium text-text-1">
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
          <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-4">
            <span />
            <div
              className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
              data-testid="channel-create-error"
            >
              {errorMessage}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

export default CreateChannelDialog;

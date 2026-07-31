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
import Modal, { MODAL_SELECT_Z_INDEX } from "@/src/scaffold/ModalSystem";
import { useAtomValue, useSetAtom } from "jotai";
import { Hash, Lock } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Checkbox from "@src/components/Checkbox";
import Select from "@src/components/Select";
import {
  normalizeChannelName,
  validateChannelName,
} from "@src/features/DiscussionChannels/channelContract";
import {
  ChannelDialogErrorNotice,
  ChannelDialogFooter,
  ChannelNameField,
  ChannelTopicField,
} from "@src/features/DiscussionChannels/components/ChannelDialogPrimitives";

import { org2CloudAuthAtom } from "../../org2CloudAuthAtom";
import { bumpOrg2CloudChannelsVersionAtom } from "../channelsAtom";
import { createCloudChannel, isOrg2ChannelsErrorCode } from "../channelsClient";
import type { CloudChannelPostPolicy, CloudChannelVisibility } from "../types";
import { CHANNEL_ADD_MEMBERS_MAX_PER_CALL } from "../types";
import {
  useActiveOrgMembers,
  useFreshChannelAccessToken,
} from "./useChannelDialogAccess";

type CreateChannelErrorKind = "nameTaken" | "quotaExceeded" | "generic";

export interface CreateChannelDialogProps {
  open: boolean;
  orgId: string | null;
  onClose: () => void;
}

const CreateChannelDialog: React.FC<CreateChannelDialogProps> = ({
  open,
  orgId,
  onClose,
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

  const orgRadioRef = useRef<HTMLButtonElement | null>(null);
  const privateRadioRef = useRef<HTMLButtonElement | null>(null);
  const handleVisibilityKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      // Two radios: any arrow toggles to the other option and moves focus.
      const next = visibility === "org" ? "private" : "org";
      setVisibility(next);
      (next === "org" ? orgRadioRef : privateRadioRef).current?.focus();
    },
    [visibility]
  );

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
      await createCloudChannel(accessToken, orgId, {
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
        <ChannelNameField
          value={name}
          onChange={setName}
          testId="channel-create-name"
        />

        <ChannelTopicField
          value={topic}
          onChange={setTopic}
          testId="channel-create-topic"
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-2">
            {t("cloud.channels.create.visibilityLabel")}
          </span>
          <div
            role="radiogroup"
            aria-label={t("cloud.channels.create.visibilityLabel")}
            className="grid grid-cols-2 gap-2"
            onKeyDown={handleVisibilityKeyDown}
          >
            <button
              type="button"
              role="radio"
              aria-checked={visibility === "org"}
              // Roving tabindex: only the checked radio is in the tab order;
              // arrow keys move the selection (ARIA radiogroup contract).
              tabIndex={visibility === "org" ? 0 : -1}
              ref={orgRadioRef}
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
              tabIndex={visibility === "private" ? 0 : -1}
              ref={privateRadioRef}
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

        <ChannelDialogErrorNotice
          message={errorMessage}
          testId="channel-create-error"
        />

        <ChannelDialogFooter
          cancelLabel={t("cloud.channels.cancel")}
          submitLabel={t("cloud.channels.create.submit")}
          onCancel={handleClose}
          onSubmit={() => void handleSubmit()}
          cancelTestId="channel-create-cancel"
          submitTestId="channel-create-submit"
          loading={submitting}
          disabled={!canSubmit}
        />
      </div>
    </Modal>
  );
};

export default CreateChannelDialog;

/**
 * Shared channel-dialog form pieces. The four create/settings dialogs
 * (cloud + local) previously hand-rolled identical name/topic blocks and
 * error notices; this is the single copy, with the label programmatically
 * associated to its input (the a11y gap every copy shared).
 */
import React, { useId } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";

import { normalizeChannelNameInput } from "../channelName";
import { CHANNEL_NAME_MAX_LENGTH, CHANNEL_TOPIC_MAX_LENGTH } from "../types";

export interface ChannelNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
}

/** '#'-adorned live-normalizing name input with the n/80 counter. */
export const ChannelNameField: React.FC<ChannelNameFieldProps> = ({
  value,
  onChange,
  testId,
}) => {
  const { t } = useTranslation("navigation");
  const inputId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[12px] font-medium text-text-2">
        {t("cloud.channels.create.nameLabel")}
      </label>
      <Input
        id={inputId}
        value={value}
        onChange={(next) => onChange(normalizeChannelNameInput(next))}
        placeholder={t("cloud.channels.create.namePlaceholder")}
        maxLength={CHANNEL_NAME_MAX_LENGTH}
        prefix={<span className="text-[13px] text-text-3">#</span>}
        suffix={
          <span className="text-[11px] tabular-nums text-text-4">
            {value.length}/{CHANNEL_NAME_MAX_LENGTH}
          </span>
        }
        data-testid={testId}
      />
    </div>
  );
};

export interface ChannelTopicFieldProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
}

export const ChannelTopicField: React.FC<ChannelTopicFieldProps> = ({
  value,
  onChange,
  testId,
}) => {
  const { t } = useTranslation("navigation");
  const inputId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[12px] font-medium text-text-2">
        {t("cloud.channels.create.topicLabel")}{" "}
        <span className="font-normal text-text-4">
          {t("cloud.channels.create.topicOptional")}
        </span>
      </label>
      <Input
        id={inputId}
        value={value}
        onChange={onChange}
        placeholder={t("cloud.channels.create.topicPlaceholder")}
        maxLength={CHANNEL_TOPIC_MAX_LENGTH}
        data-testid={testId}
      />
    </div>
  );
};

export interface ChannelDialogErrorNoticeProps {
  message: string | null;
  testId: string;
}

/** The channels-dialog inline error box (danger-1 background pattern). */
export const ChannelDialogErrorNotice: React.FC<
  ChannelDialogErrorNoticeProps
> = ({ message, testId }) => {
  if (!message) return null;
  return (
    <div
      className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
      data-testid={testId}
    >
      {message}
    </div>
  );
};

/**
 * Scope-neutral discussion-channel dialog pieces shared by the local and
 * cloud planes. This module owns the repeated form fields, error notice,
 * confirmation body, and action footer without importing either storage or
 * network state.
 */
import { TriangleAlert } from "lucide-react";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";

import Button, { type ButtonVariant } from "@src/components/Button";
import Checkbox from "@src/components/Checkbox";
import Input from "@src/components/Input";

import {
  CHANNEL_NAME_MAX_LENGTH,
  CHANNEL_TOPIC_MAX_LENGTH,
  normalizeChannelNameInput,
} from "../channelContract";

export interface ChannelNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  /**
   * Name/topic form dialogs opt in so typing can start immediately;
   * without it ModalSystem's fallback lands focus on the header close X.
   * Confirmation dialogs must NOT autofocus their destructive action.
   */
  autoFocus?: boolean;
}

/** '#'-adorned live-normalizing name input with the n/80 counter. */
export const ChannelNameField: React.FC<ChannelNameFieldProps> = ({
  value,
  onChange,
  testId,
  autoFocus = false,
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
        autoFocus={autoFocus}
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

/** The field-label row the name/topic fields render internally. */
export const ChannelFieldLabel: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <span className="text-[12px] font-medium text-text-2">{children}</span>;

export interface ChannelDialogErrorNoticeProps {
  message: string | null;
  testId: string;
}

/**
 * The channels-dialog inline error box (danger-1 background pattern).
 * `role="alert"` because it appears dynamically after a failed submit —
 * without live-region semantics screen readers never hear the failure.
 */
export const ChannelDialogErrorNotice: React.FC<
  ChannelDialogErrorNoticeProps
> = ({ message, testId }) => {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6"
      data-testid={testId}
    >
      {message}
    </div>
  );
};

export interface ChannelDeleteConfirmationProps {
  warning: string;
  acknowledgement: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  acknowledgeTestId: string;
}

/** Shared destructive warning + explicit acknowledgement control. */
export const ChannelDeleteConfirmation: React.FC<
  ChannelDeleteConfirmationProps
> = ({ warning, acknowledgement, checked, onChange, acknowledgeTestId }) => (
  <>
    <div className="flex items-start gap-2 rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
      <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
      <span>{warning}</span>
    </div>
    <div data-testid={acknowledgeTestId}>
      <Checkbox size="small" checked={checked} onChange={onChange}>
        {acknowledgement}
      </Checkbox>
    </div>
  </>
);

export interface ChannelDialogFooterProps {
  cancelLabel: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
  cancelTestId: string;
  submitTestId: string;
  submitVariant?: Extract<ButtonVariant, "primary" | "danger">;
  loading?: boolean;
  disabled?: boolean;
}

/** The common two-action footer used by the eight confirm/form dialogs. */
export const ChannelDialogFooter: React.FC<ChannelDialogFooterProps> = ({
  cancelLabel,
  submitLabel,
  onCancel,
  onSubmit,
  cancelTestId,
  submitTestId,
  submitVariant = "primary",
  loading = false,
  disabled = false,
}) => (
  <div className="flex items-center justify-end gap-2">
    <Button
      htmlType="button"
      variant="secondary"
      onClick={onCancel}
      data-testid={cancelTestId}
    >
      {cancelLabel}
    </Button>
    <Button
      htmlType="button"
      variant={submitVariant}
      loading={loading}
      disabled={disabled}
      onClick={onSubmit}
      data-testid={submitTestId}
    >
      {submitLabel}
    </Button>
  </div>
);

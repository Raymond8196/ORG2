import { type AriaAttributes, type ReactNode, forwardRef } from "react";

import { getListItemClasses } from "@src/components/ListPanel";

type TeamInboxDataAttributes = Record<
  `data-${string}`,
  boolean | number | string | undefined
>;

export interface TeamInboxListItemProps {
  id: string;
  selected: boolean;
  title: string;
  time?: string;
  preview?: string;
  metadata?: ReactNode;
  leading: ReactNode;
  leadingClassName?: string;
  unread?: boolean;
  ariaLabel: string;
  ariaCurrent?: AriaAttributes["aria-current"];
  role?: "option";
  tabIndex?: number;
  dataAttributes?: TeamInboxDataAttributes;
  onClick: () => void;
}

const TeamInboxListItem = forwardRef<HTMLButtonElement, TeamInboxListItemProps>(
  (
    {
      id,
      selected,
      title,
      time,
      preview,
      metadata,
      leading,
      leadingClassName = "text-text-2",
      unread = false,
      ariaLabel,
      ariaCurrent,
      role,
      tabIndex,
      dataAttributes,
      onClick,
    },
    ref
  ) => (
    <button
      {...dataAttributes}
      ref={ref}
      id={id}
      type="button"
      role={role}
      aria-label={ariaLabel}
      aria-selected={role === "option" ? selected : undefined}
      aria-current={ariaCurrent}
      tabIndex={tabIndex}
      data-team-inbox-list-item
      className={`${getListItemClasses(selected)} w-full min-w-0 !items-start text-left`}
      onClick={onClick}
    >
      <span
        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center ${leadingClassName}`}
        aria-hidden
      >
        {leading}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          {unread ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-6"
              aria-hidden
            />
          ) : null}
          <span
            className={`truncate text-xs text-text-1 ${unread ? "font-semibold" : "font-medium"}`}
          >
            {title}
          </span>
          {time ? (
            <span className="ml-auto shrink-0 text-xs font-normal text-text-3">
              {time}
            </span>
          ) : null}
        </span>
        {preview ? (
          <span
            className="mt-0.5 line-clamp-2 block max-h-10 overflow-hidden text-xs font-normal leading-5 text-text-1"
            title={preview}
          >
            {preview}
          </span>
        ) : null}
        {metadata ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-normal text-text-2">
            {metadata}
          </span>
        ) : null}
      </span>
    </button>
  )
);

TeamInboxListItem.displayName = "TeamInboxListItem";

export default TeamInboxListItem;

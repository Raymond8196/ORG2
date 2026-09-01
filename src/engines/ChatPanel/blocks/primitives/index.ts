/**
 * Event Blocks - Reusable building blocks for session UI
 *
 * Export all shared blocks, configs, and types
 */

// Components
export {
  default as EventBlock,
  EventBlockExpandableStackList,
} from "./EventBlock";
export { EventBlockHeader } from "./EventBlockHeader";
export type { EventBlockHeaderProps } from "./types";
export { EventBlockHeaderIcon } from "./EventBlockHeaderIcon";
export {
  EventBlockHeaderInfo,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
} from "./EventBlockHeaderTextSlots";
export { default as EventNavigateIcon } from "./EventNavigateIcon";
export { default as ChatLoadingBlock } from "./ChatLoadingBlock";

// Hooks
export { useEventBlockHeader } from "./useEventBlockHeader";
export type {
  UseEventBlockHeaderOptions,
  UseEventBlockHeaderReturn,
} from "./useEventBlockHeader";

// Context: read-only (nested) block mode — suppresses toggle interactions
export { NestedBlockContext } from "./nestedBlockContext";

// Configuration (includes getEventBlockContainerClasses, getEventBlockHeaderClasses, getEventBlockExpandedContainer, etc.)
export * from "./config";

// Output primitive
export { default as BlockOutput } from "./BlockOutput";

// Collapsible sub-section primitive
export { default as BlockSection } from "./BlockSection";

// Shared stack list row (tool blocks + file/directory list surfaces)
export { StackListRow as ComposerStackListRow } from "@src/components/StackListRow";

// Generic expandable list with N visible by default + gradient fade + show-more
export { default as ExpandableItemList } from "./ExpandableItemList";
export type { ExpandableItemListProps } from "./ExpandableItemList";

// Stacked block primitive (paginated same-category grouping)
export { default as StackedBlock } from "./StackedBlock";

// Planning indicator footer
export { default as PlanningFooter } from "./PlanningFooter";
export type { PlanningFooterMode } from "./PlanningFooter";

// Stroke-draw animation hook for loading icons
export { useStrokeDraw } from "./useStrokeDraw";

// Failed state inline row for chat variant event components
export { FailedEventRow } from "./FailedEventRow";

// Types
export * from "./types";

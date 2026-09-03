import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface WorkManagementSplitHeaderContextValue {
  /** True while Work Management is hosted beneath either shell's tab bar. */
  hasTabBar: boolean;
  /** Dataset switch owned by Work Management's parent header. */
  datasetControl: ReactNode;
  /** Icon-only dataset switch for a compact, split list header. */
  splitDatasetControl?: ReactNode;
}

const DEFAULT_WORK_MANAGEMENT_SPLIT_HEADER_CONTEXT: WorkManagementSplitHeaderContextValue =
  {
    hasTabBar: false,
    datasetControl: null,
    splitDatasetControl: null,
  };

export const WorkManagementSplitHeaderContext =
  createContext<WorkManagementSplitHeaderContextValue>(
    DEFAULT_WORK_MANAGEMENT_SPLIT_HEADER_CONTEXT
  );

export function useWorkManagementSplitHeader(): WorkManagementSplitHeaderContextValue {
  return useContext(WorkManagementSplitHeaderContext);
}

/** A folded tab row cannot delegate away the pane's only visible header. */
export function shouldHideWorkManagementHostHeader(
  hasTabBar: boolean,
  splitSurfaceOwnsHeader: boolean
): boolean {
  return hasTabBar && splitSurfaceOwnsHeader;
}

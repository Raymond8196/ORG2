import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface WorkManagementSplitHeaderContextValue {
  /** True while Work Management is hosted beneath either shell's tab bar. */
  hasTabBar: boolean;
  /** Icon-only dataset switch for a compact, split list header. */
  splitDatasetControl: ReactNode;
}

const DEFAULT_WORK_MANAGEMENT_SPLIT_HEADER_CONTEXT: WorkManagementSplitHeaderContextValue =
  {
    hasTabBar: false,
    splitDatasetControl: null,
  };

export const WorkManagementSplitHeaderContext =
  createContext<WorkManagementSplitHeaderContextValue>(
    DEFAULT_WORK_MANAGEMENT_SPLIT_HEADER_CONTEXT
  );

export function useWorkManagementSplitHeader(): WorkManagementSplitHeaderContextValue {
  return useContext(WorkManagementSplitHeaderContext);
}

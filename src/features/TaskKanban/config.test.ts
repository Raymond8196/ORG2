import { describe, expect, it } from "vitest";

import {
  EXTERNAL_HISTORY_FILTER_BY_SOURCE,
  KANBAN_AGENT_TYPE_FILTER,
} from "./config";

describe("Task Kanban external-history filters", () => {
  it("maps Warp imported sessions to the Warp filter", () => {
    expect(EXTERNAL_HISTORY_FILTER_BY_SOURCE.warp).toBe(
      KANBAN_AGENT_TYPE_FILTER.WARP_APP
    );
  });

  it("maps newly imported CLI histories to distinct filters", () => {
    expect(EXTERNAL_HISTORY_FILTER_BY_SOURCE.mimo_code).toBe(
      KANBAN_AGENT_TYPE_FILTER.MIMO_CODE_APP
    );
    expect(EXTERNAL_HISTORY_FILTER_BY_SOURCE.omp).toBe(
      KANBAN_AGENT_TYPE_FILTER.OMP_APP
    );
    expect(EXTERNAL_HISTORY_FILTER_BY_SOURCE.qoder_cli).toBe(
      KANBAN_AGENT_TYPE_FILTER.QODER_CLI_APP
    );
  });
});

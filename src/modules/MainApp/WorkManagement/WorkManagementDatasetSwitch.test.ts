import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkManagementDatasetSwitch } from "./WorkManagementDatasetSwitch";
import { WORK_MANAGEMENT_DATASET } from "./workManagementDataset";

describe("WorkManagementDatasetSwitch", () => {
  it("keeps every compact dataset control named for assistive technology", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkManagementDatasetSwitch, {
        activeDataset: WORK_MANAGEMENT_DATASET.WORK_ITEMS,
        compact: true,
        onChange: vi.fn(),
      })
    );

    expect(markup).toContain('data-testid="work-dataset-work-items"');
    expect(markup).toContain('data-testid="work-dataset-github-issues"');
    expect(markup).toContain('data-testid="work-dataset-reviews"');
    expect(markup.match(/class="sr-only"/g)).toHaveLength(3);
  });
});

// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import SetupWalkthrough from "../index";
import { SETUP_WALKTHROUGH_PRESENTATION } from "../presentation";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  previewStyle: "compact",
  previewStyleAtom: Symbol("applicationPreviewStyleAtom"),
  saveSettings: vi.fn(),
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: unknown) =>
    atom === mocks.previewStyleAtom
      ? mocks.previewStyle
      : { "general.setupWalkthroughProgress": undefined },
  useSetAtom: () => mocks.saveSettings,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) =>
    React.createElement("span", null, i18nKey),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@src/components/AppLogo", () => ({
  default: () => React.createElement("span", { "data-testid": "app-logo" }),
}));

vi.mock("@src/features/GitHubStar", () => ({
  signalGitHubStarValueMoment: vi.fn(),
}));

vi.mock("@src/store/settings/settingsAtom", () => ({
  saveSettingsBatchAtom: {},
  settingsAtom: {},
}));

vi.mock("@src/store/ui/globalPreferencesPanelAtom", () => ({
  applicationPreviewStyleAtom: mocks.previewStyleAtom,
}));

vi.mock("@src/modules/shared/layouts", () => ({
  OnboardingLayout: ({
    leftContent,
    rightContent,
  }: {
    leftContent: React.ReactNode;
    rightContent?: React.ReactNode;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "setup-layout",
        "data-layout": rightContent == null ? "single" : "split",
      },
      leftContent,
      rightContent
    ),
}));

vi.mock("../components/SetupWalkthroughSidebar", () => ({
  default: ({ presentation }: { presentation: string }) =>
    React.createElement("div", {
      "data-testid": "setup-preview",
      "data-presentation": presentation,
    }),
}));

vi.mock("../components/SetupPreferencesPanel", () => ({
  default: () =>
    React.createElement("div", { "data-testid": "setup-preferences" }),
}));

describe("SetupWalkthrough presentation layout", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(async () => {
    mocks.previewStyle = SETUP_WALKTHROUGH_PRESENTATION.COMPACT;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(SetupWalkthrough));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps the split layout and reads the global preview preference", () => {
    const layout = container.querySelector<HTMLElement>(
      '[data-testid="setup-layout"]'
    );
    const preview = container.querySelector<HTMLElement>(
      '[data-testid="setup-preview"]'
    );
    expect(layout?.dataset.layout).toBe("split");
    expect(preview?.dataset.presentation).toBe(
      SETUP_WALKTHROUGH_PRESENTATION.COMPACT
    );

    expect(layout?.dataset.layout).toBe("split");
    expect(
      container.querySelector('[data-testid="setup-presentation-switch"]')
    ).toBeNull();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it("hydrates the shared preview preference after remount", async () => {
    mocks.previewStyle = SETUP_WALKTHROUGH_PRESENTATION.MASCOT;
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(SetupWalkthrough));
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="setup-layout"]')
        ?.dataset.layout
    ).toBe("split");
    expect(
      container.querySelector<HTMLElement>('[data-testid="setup-preview"]')
        ?.dataset.presentation
    ).toBe(SETUP_WALKTHROUGH_PRESENTATION.MASCOT);
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
});

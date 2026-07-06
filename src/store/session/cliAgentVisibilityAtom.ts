import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type CliAgentVisibilityOverrides = Record<string, boolean>;

const STORAGE_KEY = "orgii:cliAgentVisibilityOverrides";

export const cliAgentVisibilityOverridesAtom =
  atomWithStorage<CliAgentVisibilityOverrides>(STORAGE_KEY, {});

export function isCliAgentEnabled(
  agentName: string,
  installed: boolean,
  overrides: CliAgentVisibilityOverrides
): boolean {
  return overrides[agentName] ?? installed;
}

export const setCliAgentEnabledAtom = atom(
  null,
  (get, set, agentName: string, enabled: boolean, installed: boolean) => {
    const overrides = get(cliAgentVisibilityOverridesAtom);
    const defaultEnabled = installed;

    if (enabled === defaultEnabled) {
      const { [agentName]: _removed, ...rest } = overrides;
      set(cliAgentVisibilityOverridesAtom, rest);
      return;
    }

    set(cliAgentVisibilityOverridesAtom, {
      ...overrides,
      [agentName]: enabled,
    });
  }
);

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitHubRepoPermissions } from "@src/api/tauri/github";

import type { GitHubRepoSource } from "./githubWorkItemsTypes";
import { loadRepoPermissions } from "./useGitHubWorkItemsLoadLifecycle";

const mocks = vi.hoisted(() => ({
  getGitHubRepoPermissionsLocal: vi.fn(),
}));

vi.mock("@src/api/tauri/github", () => ({
  getGitHubRepoPermissionsLocal: mocks.getGitHubRepoPermissionsLocal,
  getGitHubViewerLogin: vi.fn(),
  listPRsLocal: vi.fn(),
}));

const source: GitHubRepoSource = {
  repoId: "repo-1",
  repoPath: "/repo",
  label: "repo",
  remoteUrl: "https://github.com/acme/repo.git",
  repoFullName: "acme/repo",
  viewerLogin: "viewer",
  permissions: null,
};

const permissions: GitHubRepoPermissions = {
  role_name: "write",
  can_manage_issues: true,
  can_manage_pull_requests: true,
};

describe("GitHub work-item permission loading", () => {
  beforeEach(() => {
    mocks.getGitHubRepoPermissionsLocal.mockReset();
    mocks.getGitHubRepoPermissionsLocal.mockResolvedValue(permissions);
  });

  it("shares one in-flight request per viewer and repository", async () => {
    const requests = new Map<string, Promise<GitHubRepoPermissions | null>>();

    const [first, second] = await Promise.all([
      loadRepoPermissions(source, "viewer", requests),
      loadRepoPermissions(source, "viewer", requests),
    ]);

    expect(first).toEqual([source.repoFullName, permissions]);
    expect(second).toEqual(first);
    expect(mocks.getGitHubRepoPermissionsLocal).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a permission request across viewer identities", async () => {
    const requests = new Map<string, Promise<GitHubRepoPermissions | null>>();

    await loadRepoPermissions(source, "viewer", requests);
    await loadRepoPermissions(source, "other-viewer", requests);

    expect(mocks.getGitHubRepoPermissionsLocal).toHaveBeenCalledTimes(2);
  });
});

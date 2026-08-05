import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createIssueCommentLocal,
  getGitHubRepoPermissionsLocal,
  getGitHubViewerLogin,
  listIssueTimelineLocal,
  listIssuesLocal,
  updateIssueLocal,
} from "@src/api/tauri/github";
import type {
  GitHubIssue,
  GitHubIssueTimelineItem,
  GitHubIssueUser,
  GitHubRepoPermissions,
} from "@src/api/tauri/github";
import type {
  GitHubIssueInteractionConfig,
  GitHubIssueStatusChangeOptions,
} from "@src/modules/ProjectManager/WorkItems/components/WorkItemContent/types";
import { parseGithubRepoFullName } from "@src/services/git/operations/createPullRequest";
import {
  fetchIssue,
  fetchIssueTimeline,
  issueCommentToTimelineItem,
} from "@src/services/git/operations/githubIssues";
import {
  workstationIssueCallbackAtomFamily,
  workstationSelectedIssueAtomFamily,
} from "@src/store/workstation/codeEditor/workstationIssueAtom";
import { workstationRepoScopeKey } from "@src/store/workstation/codeEditor/workstationPrAtom";

export interface GitHubIssueDetailStateOptions {
  /** Omit for repo-scoped Source Control, which already owns the selection. */
  issueNumber?: number;
  repoPath: string;
  repoId?: string;
  remoteUrl?: string;
  stateScopeKey?: string;
}

interface GitHubIssueInteractionResolution {
  key: string;
  viewer: GitHubIssueUser | null;
  permissions: GitHubRepoPermissions | null;
  duplicateCandidates: GitHubIssue[];
  duplicateCandidatesLoaded: boolean;
  loadingDuplicateCandidates: boolean;
  duplicateCandidatesError: boolean;
  submittingComment: boolean;
  updatingBody: boolean;
  updatingStatus: boolean;
  error: GitHubIssueInteractionConfig["error"];
}

function sameLogin(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function resolveViewer(
  login: string,
  issue: GitHubIssue | null,
  timeline: GitHubIssueTimelineItem[]
): GitHubIssueUser {
  const knownUsers = [
    issue?.user,
    ...(issue?.assignees ?? []),
    ...timeline.map((item) => item.actor),
  ].filter((user): user is GitHubIssueUser => Boolean(user));
  const knownViewer = knownUsers.find((user) => sameLogin(user.login, login));

  return (
    knownViewer ?? {
      login,
      avatar_url: `https://github.com/${encodeURIComponent(login)}.png?size=64`,
    }
  );
}

function isRepoFullName(value: string | null): value is string {
  return Boolean(value && /^[^/\s]+\/[^/\s]+$/.test(value));
}

export function resolveGitHubIssueRepoFullName(
  remoteUrl: string | undefined,
  issueUrl: string | undefined
): string | null {
  const remoteRepo = remoteUrl ? parseGithubRepoFullName(remoteUrl) : null;
  if (isRepoFullName(remoteRepo)) return remoteRepo;

  if (!issueUrl) return null;
  try {
    const url = new URL(issueUrl);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo, kind] = url.pathname.split("/").filter(Boolean);
    return owner && repo && kind === "issues" ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

function canEditIssue(
  resolution: GitHubIssueInteractionResolution | null,
  issue: GitHubIssue | null
): boolean {
  return (
    resolution?.permissions?.can_manage_issues === true ||
    Boolean(
      issue &&
      resolution?.viewer &&
      sameLogin(issue.user.login, resolution.viewer.login)
    )
  );
}

/** Shared issue-detail state and Inbox-style interactions for every host. */
export function useGitHubIssueDetailState({
  issueNumber: requestedIssueNumber,
  repoPath,
  repoId,
  remoteUrl,
  stateScopeKey: requestedStateScopeKey,
}: GitHubIssueDetailStateOptions) {
  const repoScopeKey = workstationRepoScopeKey(repoId, repoPath);
  const stateScopeKey = requestedStateScopeKey ?? repoScopeKey;
  const selectedState = useAtomValue(
    workstationSelectedIssueAtomFamily(stateScopeKey)
  );
  const issueNumber = requestedIssueNumber ?? selectedState.issue?.number ?? 0;
  const callbacks = useAtomValue(
    workstationIssueCallbackAtomFamily(repoScopeKey)
  );
  const setSelectedState = useSetAtom(
    workstationSelectedIssueAtomFamily(stateScopeKey)
  );
  const [resolution, setResolution] =
    useState<GitHubIssueInteractionResolution | null>(null);
  const selectedIssueRef = useRef(selectedState.issue);
  const selectedTimelineRef = useRef(selectedState.timeline);
  const requestGenerationRef = useRef(0);
  const duplicateRequestRef = useRef<{
    key: string;
    generation: number;
    promise: Promise<void>;
  } | null>(null);

  useEffect(() => {
    selectedIssueRef.current = selectedState.issue;
    selectedTimelineRef.current = selectedState.timeline;
  }, [selectedState.issue, selectedState.timeline]);

  useEffect(() => {
    if (
      issueNumber <= 0 ||
      selectedState.issue?.number === issueNumber ||
      !remoteUrl
    ) {
      return;
    }
    let cancelled = false;
    setSelectedState((prev) => ({
      ...prev,
      loading: true,
      timelineLoading: true,
      error: null,
    }));
    void Promise.all([
      fetchIssue(remoteUrl, issueNumber),
      fetchIssueTimeline({ remoteUrl, issueNumber }),
    ]).then(([issueResult, timelineResult]) => {
      if (cancelled) return;
      setSelectedState((prev) => ({
        ...prev,
        issue: issueResult.data ?? null,
        timeline: timelineResult.data ?? [],
        loading: false,
        timelineLoading: false,
        error: issueResult.error ?? timelineResult.error ?? null,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [issueNumber, remoteUrl, selectedState.issue?.number, setSelectedState]);

  const repoFullName = resolveGitHubIssueRepoFullName(
    remoteUrl,
    selectedState.issue?.html_url
  );
  const requestKey =
    repoFullName && issueNumber > 0 ? `${repoFullName}#${issueNumber}` : null;
  const currentResolution = resolution?.key === requestKey ? resolution : null;

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    if (!requestKey || !repoFullName) {
      duplicateRequestRef.current = null;
      return;
    }
    let cancelled = false;
    const currentIssue = selectedIssueRef.current;
    const currentTimeline = selectedTimelineRef.current;

    void Promise.allSettled([
      getGitHubViewerLogin(),
      getGitHubRepoPermissionsLocal(repoFullName),
    ]).then(([viewerResult, permissionsResult]) => {
      if (cancelled || requestGenerationRef.current !== generation) return;
      setResolution({
        key: requestKey,
        viewer:
          viewerResult.status === "fulfilled"
            ? resolveViewer(viewerResult.value, currentIssue, currentTimeline)
            : null,
        permissions:
          permissionsResult.status === "fulfilled"
            ? permissionsResult.value
            : null,
        duplicateCandidates: [],
        duplicateCandidatesLoaded: false,
        loadingDuplicateCandidates: false,
        duplicateCandidatesError: false,
        submittingComment: false,
        updatingBody: false,
        updatingStatus: false,
        error: null,
      });
    });

    return () => {
      cancelled = true;
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
      }
      if (duplicateRequestRef.current?.key === requestKey) {
        duplicateRequestRef.current = null;
      }
    };
  }, [repoFullName, requestKey]);

  const loadDuplicateCandidates = useCallback((): Promise<void> => {
    if (!requestKey || !repoFullName || !currentResolution) {
      return Promise.reject(new Error("github_duplicate_issues_unavailable"));
    }
    if (currentResolution.duplicateCandidatesLoaded) {
      return Promise.resolve();
    }
    const generation = requestGenerationRef.current;
    if (
      duplicateRequestRef.current?.key === requestKey &&
      duplicateRequestRef.current.generation === generation
    ) {
      return duplicateRequestRef.current.promise;
    }

    setResolution((current) =>
      current?.key === requestKey
        ? {
            ...current,
            loadingDuplicateCandidates: true,
            duplicateCandidatesError: false,
          }
        : current
    );

    const promise = listIssuesLocal(repoFullName, {
      state: "all",
      page: 1,
      perPage: 100,
      includeLinkedPullRequests: false,
    })
      .then(({ issues }) => {
        const candidates = issues.filter(
          (candidate) =>
            candidate.number !== issueNumber &&
            typeof candidate.id === "number" &&
            candidate.id > 0
        );
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                duplicateCandidates: candidates,
                duplicateCandidatesLoaded: true,
                loadingDuplicateCandidates: false,
                duplicateCandidatesError: false,
              }
            : current
        );
      })
      .catch((error) => {
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                loadingDuplicateCandidates: false,
                duplicateCandidatesError: true,
              }
            : current
        );
        throw error;
      })
      .finally(() => {
        if (duplicateRequestRef.current?.promise === promise) {
          duplicateRequestRef.current = null;
        }
      });

    duplicateRequestRef.current = { key: requestKey, generation, promise };
    return promise;
  }, [currentResolution, issueNumber, repoFullName, requestKey]);

  const addComment = useCallback(
    async (body: string) => {
      const issue = selectedState.issue;
      if (
        !requestKey ||
        !repoFullName ||
        !issue ||
        !currentResolution?.viewer ||
        currentResolution.submittingComment
      ) {
        throw new Error("github_comment_unavailable");
      }
      setResolution((current) =>
        current?.key === requestKey
          ? { ...current, submittingComment: true, error: null }
          : current
      );

      try {
        const comment = await createIssueCommentLocal(
          repoFullName,
          issue.number,
          body
        );
        setSelectedState((current) =>
          current.issue?.number === issue.number
            ? {
                ...current,
                issue: {
                  ...current.issue,
                  comments: current.issue.comments + 1,
                },
                timeline: [
                  ...current.timeline,
                  issueCommentToTimelineItem(comment),
                ],
              }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, submittingComment: false, error: null }
            : current
        );
      } catch (error) {
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, submittingComment: false, error: "comment" }
            : current
        );
        throw error;
      }
    },
    [
      currentResolution,
      repoFullName,
      requestKey,
      selectedState.issue,
      setSelectedState,
    ]
  );

  const updateBody = useCallback(
    async (body: string) => {
      const issue = selectedState.issue;
      if (
        !requestKey ||
        !repoFullName ||
        !issue ||
        !currentResolution ||
        currentResolution.updatingBody ||
        currentResolution.updatingStatus
      ) {
        throw new Error("github_body_update_unavailable");
      }
      if (!canEditIssue(currentResolution, issue)) {
        throw new Error("github_body_update_forbidden");
      }

      setResolution((current) =>
        current?.key === requestKey
          ? { ...current, updatingBody: true, error: null }
          : current
      );
      try {
        const updatedIssue = await updateIssueLocal(
          repoFullName,
          issue.number,
          { body }
        );
        setSelectedState((current) =>
          current.issue?.number === issue.number
            ? { ...current, issue: updatedIssue }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingBody: false }
            : current
        );
        callbacks.refreshIssues?.();
      } catch (error) {
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingBody: false }
            : current
        );
        throw error;
      }
    },
    [
      callbacks,
      currentResolution,
      repoFullName,
      requestKey,
      selectedState.issue,
      setSelectedState,
    ]
  );

  const changeStatus = useCallback(
    async (
      state: GitHubIssue["state"],
      options?: GitHubIssueStatusChangeOptions
    ) => {
      const issue = selectedState.issue;
      if (
        !requestKey ||
        !repoFullName ||
        !issue ||
        !currentResolution ||
        currentResolution.updatingStatus ||
        currentResolution.updatingBody
      ) {
        throw new Error("github_status_unavailable");
      }
      if (!canEditIssue(currentResolution, issue)) {
        throw new Error("github_status_forbidden");
      }
      const stateReason =
        state === "closed" ? (options?.stateReason ?? "completed") : undefined;
      if (
        stateReason === "duplicate" &&
        (!options?.duplicateIssueId || options.duplicateIssueId <= 0)
      ) {
        throw new Error("github_duplicate_issue_required");
      }

      setResolution((current) =>
        current?.key === requestKey
          ? { ...current, updatingStatus: true, error: null }
          : current
      );
      try {
        const updatedIssue = await updateIssueLocal(
          repoFullName,
          issue.number,
          {
            state,
            stateReason,
            ...(stateReason === "duplicate"
              ? { duplicateIssueId: options?.duplicateIssueId }
              : {}),
          }
        );
        const timeline = await listIssueTimelineLocal(
          repoFullName,
          issue.number
        ).catch(() => selectedState.timeline);
        setSelectedState((current) =>
          current.issue?.number === issue.number
            ? { ...current, issue: updatedIssue, timeline }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingStatus: false, error: null }
            : current
        );
        callbacks.refreshIssues?.();
      } catch (error) {
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingStatus: false, error: "status" }
            : current
        );
        throw error;
      }
    },
    [
      callbacks,
      currentResolution,
      repoFullName,
      requestKey,
      selectedState.issue,
      selectedState.timeline,
      setSelectedState,
    ]
  );

  const interaction = useMemo<GitHubIssueInteractionConfig>(() => {
    const issue = selectedState.issue;
    const canManageStatus = canEditIssue(currentResolution, issue);

    return {
      viewer: currentResolution?.viewer ?? null,
      issueState: issue?.state ?? "open",
      duplicateCandidates: currentResolution?.duplicateCandidates ?? [],
      duplicateCandidatesLoaded:
        currentResolution?.duplicateCandidatesLoaded ?? false,
      loadingDuplicateCandidates:
        currentResolution?.loadingDuplicateCandidates ?? false,
      duplicateCandidatesError:
        currentResolution?.duplicateCandidatesError ?? false,
      loading: Boolean(requestKey) && !currentResolution,
      canComment: Boolean(currentResolution?.viewer),
      canEditBody: canManageStatus,
      canManageStatus,
      submittingComment: currentResolution?.submittingComment ?? false,
      updatingBody: currentResolution?.updatingBody ?? false,
      updatingStatus: currentResolution?.updatingStatus ?? false,
      error: currentResolution?.error ?? null,
      onAddComment: addComment,
      onUpdateBody: updateBody,
      onLoadDuplicateCandidates: loadDuplicateCandidates,
      onStatusChange: changeStatus,
    };
  }, [
    addComment,
    changeStatus,
    currentResolution,
    loadDuplicateCandidates,
    requestKey,
    selectedState.issue,
    updateBody,
  ]);

  return { selectedState, interaction };
}

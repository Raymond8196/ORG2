import { useStore } from "jotai";
import { useCallback, useEffect, useState } from "react";

import type { GitHubIssue, GitHubIssueComment } from "@src/api/tauri/github";
import { useWorkStationTabs } from "@src/hooks/workStation/tabs";
import {
  addIssueComment,
  closeIssue,
  fetchIssueComments,
  reopenIssue,
} from "@src/services/git/operations/githubIssues";
import { workstationSelectedIssueAtomFamily } from "@src/store/workstation/codeEditor/workstationIssueAtom";
import { workstationRepoScopeKey } from "@src/store/workstation/codeEditor/workstationPrAtom";
import { createGitHubIssueDetailTab } from "@src/store/workstation/tabs";

import type { ManagedIssueItem } from "./githubWorkItemsModel";

export interface IssueDetailState {
  source: ManagedIssueItem;
  issue: GitHubIssue;
  comments: GitHubIssueComment[];
  commentsLoading: boolean;
  submittingComment: boolean;
  error: string | null;
}

export function useGitHubIssueDetail(
  onDetailViewChange: (open: boolean, onBack: (() => void) | null) => void
) {
  const store = useStore();
  const { openTab } = useWorkStationTabs();
  const [issueDetail, setIssueDetail] = useState<IssueDetailState | null>(null);
  const detailViewOpen = Boolean(issueDetail);

  const handleBackFromDetail = useCallback(() => {
    setIssueDetail(null);
  }, []);

  useEffect(() => {
    onDetailViewChange(
      detailViewOpen,
      detailViewOpen ? handleBackFromDetail : null
    );
  }, [detailViewOpen, handleBackFromDetail, onDetailViewChange]);

  useEffect(
    () => () => {
      onDetailViewChange(false, null);
    },
    [onDetailViewChange]
  );

  const handleOpenIssue = useCallback((issue: ManagedIssueItem) => {
    setIssueDetail({
      source: issue,
      issue: issue.rawIssue,
      comments: [],
      commentsLoading: true,
      submittingComment: false,
      error: null,
    });

    void (async () => {
      const result = await fetchIssueComments({
        remoteUrl: issue.remoteUrl,
        issueNumber: issue.id,
      });
      setIssueDetail((current) => {
        if (current?.issue.html_url !== issue.rawIssue.html_url) {
          return current;
        }
        return {
          ...current,
          comments: result.data ?? [],
          commentsLoading: false,
          error: result.error ?? null,
        };
      });
    })();
  }, []);

  const handleOpenIssueInMyStation = useCallback(
    (issue: ManagedIssueItem) => {
      const selectedIssueAtom = workstationSelectedIssueAtomFamily(
        workstationRepoScopeKey(undefined, issue.repoPath)
      );
      store.set(selectedIssueAtom, {
        issue: issue.rawIssue,
        comments: [],
        loading: false,
        commentsLoading: true,
        error: null,
        submittingComment: false,
      });
      openTab(
        createGitHubIssueDetailTab(
          issue.id,
          issue.title,
          issue.repoPath,
          issue.remoteUrl
        )
      );

      void (async () => {
        const result = await fetchIssueComments({
          remoteUrl: issue.remoteUrl,
          issueNumber: issue.id,
        });
        store.set(selectedIssueAtom, (current) => {
          if (current.issue?.html_url !== issue.rawIssue.html_url) {
            return current;
          }
          return {
            ...current,
            comments: result.data ?? [],
            commentsLoading: false,
            error: result.error ?? null,
          };
        });
      })();
    },
    [openTab, store]
  );

  const handleCloseIssueDetail = useCallback(async () => {
    const currentIssue = issueDetail;
    if (!currentIssue) return;
    const result = await closeIssue({
      remoteUrl: currentIssue.source.remoteUrl,
      issueNumber: currentIssue.issue.number,
    });
    setIssueDetail((current) => {
      if (!current || current.issue.html_url !== currentIssue.issue.html_url) {
        return current;
      }
      if (result.data) {
        return { ...current, issue: result.data, error: null };
      }
      return { ...current, error: result.error };
    });
  }, [issueDetail]);

  const handleReopenIssueDetail = useCallback(async () => {
    const currentIssue = issueDetail;
    if (!currentIssue) return;
    const result = await reopenIssue({
      remoteUrl: currentIssue.source.remoteUrl,
      issueNumber: currentIssue.issue.number,
    });
    setIssueDetail((current) => {
      if (!current || current.issue.html_url !== currentIssue.issue.html_url) {
        return current;
      }
      if (result.data) {
        return { ...current, issue: result.data, error: null };
      }
      return { ...current, error: result.error };
    });
  }, [issueDetail]);

  const handleAddIssueDetailComment = useCallback(
    async (body: string) => {
      const currentIssue = issueDetail;
      if (!currentIssue) return;
      setIssueDetail((current) =>
        current?.issue.html_url === currentIssue.issue.html_url
          ? { ...current, submittingComment: true }
          : current
      );
      const result = await addIssueComment({
        remoteUrl: currentIssue.source.remoteUrl,
        issueNumber: currentIssue.issue.number,
        body,
      });
      if (result.data) {
        const comment = result.data;
        setIssueDetail((current) =>
          current?.issue.html_url === currentIssue.issue.html_url
            ? {
                ...current,
                issue: {
                  ...current.issue,
                  comments: current.issue.comments + 1,
                },
                comments: [...current.comments, comment],
                submittingComment: false,
                error: null,
              }
            : current
        );
        return;
      }
      setIssueDetail((current) =>
        current?.issue.html_url === currentIssue.issue.html_url
          ? { ...current, submittingComment: false, error: result.error }
          : current
      );
      throw new Error(result.error);
    },
    [issueDetail]
  );

  return {
    issueDetail,
    clearIssueDetail: handleBackFromDetail,
    handleAddIssueDetailComment,
    handleBackFromDetail,
    handleCloseIssueDetail,
    handleOpenIssue,
    handleOpenIssueInMyStation,
    handleReopenIssueDetail,
  };
}

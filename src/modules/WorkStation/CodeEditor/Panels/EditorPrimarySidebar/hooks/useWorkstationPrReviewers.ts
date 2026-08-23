/**
 * useWorkstationPrReviewers
 *
 * Reviewer-candidate state for the PR detail panel: the assignee list is
 * fetched at most once per resolved repository, and reset whenever the
 * repository changes.
 */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type GitHubIssueUser,
  listRepoAssigneesLocal,
} from "@src/api/tauri/github";

export interface UseWorkstationPrReviewersOptions {
  repoFullName: string | null;
  /** Login of the PR author, excluded from the candidate list. */
  latestAuthorLoginRef: React.MutableRefObject<string | null>;
}

export function useWorkstationPrReviewers({
  repoFullName,
  latestAuthorLoginRef,
}: UseWorkstationPrReviewersOptions) {
  const reviewerCandidatesAttemptedRef = useRef(false);
  const [reviewerCandidates, setReviewerCandidates] = useState<
    GitHubIssueUser[]
  >([]);
  const [loadingReviewerCandidates, setLoadingReviewerCandidates] =
    useState(false);
  const [reviewerCandidatesError, setReviewerCandidatesError] = useState<
    string | null
  >(null);

  useEffect(() => {
    reviewerCandidatesAttemptedRef.current = false;
    setReviewerCandidates([]);
    setLoadingReviewerCandidates(false);
    setReviewerCandidatesError(null);
  }, [repoFullName]);

  const loadReviewerCandidates = useCallback(async (): Promise<void> => {
    if (!repoFullName || reviewerCandidatesAttemptedRef.current) return;
    reviewerCandidatesAttemptedRef.current = true;
    setLoadingReviewerCandidates(true);
    setReviewerCandidatesError(null);
    try {
      const authorLogin = latestAuthorLoginRef.current?.toLowerCase();
      const candidates = await listRepoAssigneesLocal(repoFullName);
      setReviewerCandidates(
        candidates.filter(
          (candidate) => candidate.login.toLowerCase() !== authorLogin
        )
      );
    } catch (error) {
      reviewerCandidatesAttemptedRef.current = false;
      setReviewerCandidatesError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setLoadingReviewerCandidates(false);
    }
  }, [repoFullName, latestAuthorLoginRef]);

  return {
    reviewerCandidates,
    loadingReviewerCandidates,
    reviewerCandidatesError,
    loadReviewerCandidates,
  };
}

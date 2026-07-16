/**
 * "Session Sync" Settings section (cloud design §20.1 + §4.2).
 *
 * Two tabs:
 *  1. Cloud — ORG2 Cloud (managed) with the existing sign-in /
 *     sign-out control. Sign-in opens the managed cloud login page in an
 *     app-managed webview window (the `org2_cloud_open_login` Tauri
 *     command, mirroring the Codex/Gemini OAuth pattern). The login page
 *     finishes with a navigation to `orgii://auth/callback#…`, which the
 *     Rust side intercepts and forwards as the `org2-cloud-auth-callback`
 *     event handled at the always-mounted app root (useDeepLinkHandler) so
 *     it survives this section unmounting. The deep-link path in
 *     useDeepLinkHandler stays as a fallback for external browser flows.
 *     Includes the agent task runner card (`CloudAgentRunnerCard`, agent-pickup §4 item
 *     7) — per-org account/model/mode defaults for comment-task runs;
 *     hidden until a cloud org exists.
 *  2. Self-hosted — the custom ORG2 Cloud backend card (`CloudEndpointCard`,
 *     cloud-parity Phase C): self-hosting means deploying the SAME stack
 *     and pointing the app at it.
 */
import {
  SECTION_ACTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { invoke } from "@tauri-apps/api/core";
import { useAtom } from "jotai";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import CloudAgentRunnerCard from "@src/features/Org2Cloud/CloudAgentRunnerCard";
import CloudEndpointCard from "@src/features/Org2Cloud/CloudEndpointCard";
import {
  buildOrg2CloudLoginUrl,
  getCloudEndpoint,
} from "@src/features/Org2Cloud/config";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("Org2CloudSection");

export const COLLABORATION_TAB_KEYS = {
  CLOUD: "cloud",
  SELF_HOSTED: "self-hosted",
} as const;

interface Org2CloudSectionProps {
  activeTab?: string;
}

const Org2CloudSection: React.FC<Org2CloudSectionProps> = ({
  activeTab = COLLABORATION_TAB_KEYS.CLOUD,
}) => {
  const { t } = useTranslation("navigation");
  const [auth, setAuth] = useAtom(org2CloudAuthAtom);

  const handleSignIn = useCallback(() => {
    // App-managed login window; window.open(_blank) is a no-op in the
    // bundled WKWebView (no window-open handler is installed). The Rust
    // command validates the URL against the CONFIGURED origin (official or
    // custom endpoint, Phase C) — resolved here from the same settings that
    // built the login URL.
    invoke("org2_cloud_open_login", {
      loginUrl: buildOrg2CloudLoginUrl(),
      allowedOrigin: getCloudEndpoint().webOrigin,
    }).catch((error: unknown) => {
      log.error("failed to open ORG2 Cloud login window", error);
    });
  }, []);

  // The `org2-cloud-auth-callback` event from the in-app login window is now
  // handled at the always-mounted app root (useDeepLinkHandler), so sign-in
  // completes even if this Settings section is unmounted while the login
  // window is open. This section only owns the sign-in / sign-out controls.

  const handleSignOut = useCallback(() => {
    setAuth(null);
  }, [setAuth]);

  if (activeTab === COLLABORATION_TAB_KEYS.SELF_HOSTED) {
    return <CloudEndpointCard />;
  }

  return (
    <>
      <SectionContainer>
        <SectionRow
          label={
            <span className="flex items-center gap-2">
              <span>{t("cloud.title")}</span>
              <span className="rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-6">
                {t("cloud.recommendedBadge")}
              </span>
            </span>
          }
          description={t("cloud.recommendedDesc")}
          align="start"
        >
          <div className={SECTION_ACTION_GAP_CLASSES}>
            {auth ? (
              <Button
                size="default"
                onClick={handleSignOut}
                data-testid="org2-cloud-sign-out"
              >
                {t("cloud.signOut")}
              </Button>
            ) : (
              <Button
                size="default"
                onClick={handleSignIn}
                data-testid="org2-cloud-sign-in"
              >
                {t("cloud.signIn")}
              </Button>
            )}
          </div>
        </SectionRow>
      </SectionContainer>

      {/* Per-org agent-task runner defaults; hidden until an org exists. */}
      <CloudAgentRunnerCard />
    </>
  );
};

export default Org2CloudSection;

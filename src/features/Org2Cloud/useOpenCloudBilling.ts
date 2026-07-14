/**
 * Shared "open the billing page" affordance for every desktop paywall
 * touchpoint (plan section, scope-cap hint, retention-expired toasts).
 *
 * Opens a dedicated app-managed webview whose web login returns to billing.
 * Its cookie/refresh lifecycle is intentionally independent from the desktop
 * session so opening Billing can never rotate the desktop's refresh token.
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import i18n from "@src/i18n";

import { buildCloudBillingLoginUrl, getCloudEndpoint } from "./config";

const log = createLogger("Org2CloudBilling");

async function openCloudBillingWindow(): Promise<void> {
  const allowedOrigin = getCloudEndpoint().webOrigin;
  await invoke("org2_cloud_open_billing", {
    billingUrl: buildCloudBillingLoginUrl(),
    allowedOrigin,
  });
}

/**
 * Stable callback that opens the ORG2 Cloud billing login in an app-managed
 * webview window.
 */
export function useOpenCloudBilling(): () => void {
  return useCallback(() => {
    void openCloudBillingWindow().catch((error: unknown) => {
      log.error("failed to open ORG2 Cloud billing window", error);
      Message.error(i18n.t("navigation:cloud.billing.openFailed"));
    });
  }, []);
}

type PageLocation = Pick<Location, "href">;

/**
 * Marks a `<link rel="stylesheet">` owned by the theme system.
 *
 * Kept as a literal rather than an import so this module stays free of theme
 * dependencies on the pre-React startup path. `assetLoadRecovery.test.ts` has a
 * drift guard asserting both writers still use this exact attribute:
 * `src/util/core/init/themeInit.ts` and `src/util/ui/theme/swapThemeCss.ts`.
 */
const THEME_LINK_ATTR = "data-orgii-theme";

function isSameOrigin(resourceUrl: string, pageHref: string): boolean {
  if (!resourceUrl) return false;

  try {
    const resource = new URL(resourceUrl, pageHref);
    const page = new URL(pageHref);

    // `URL.origin` is "null" for custom schemes such as Tauri's, so compare
    // the URL authority directly instead of treating every custom URL as the
    // same origin.
    return resource.protocol === page.protocol && resource.host === page.host;
  } catch {
    return false;
  }
}

function hasAttributeSafe(target: unknown, attribute: string): boolean {
  const element = target as { hasAttribute?: (name: string) => boolean };
  return typeof element.hasAttribute === "function"
    ? element.hasAttribute(attribute)
    : false;
}

/**
 * Return true when a failed DOM resource is an app-owned executable asset
 * whose failure is only recoverable by reloading the page.
 *
 * WebKit reports a failed dynamic import as the generic `TypeError: Load
 * failed`, which is indistinguishable from an ordinary failed API request at
 * the promise boundary. The resource error target is authoritative: webpack
 * injects a same-origin script (or, in production, a `mini-css-extract`
 * stylesheet) element for every lazy asset.
 *
 * Theme stylesheets are deliberately excluded. `themeInit.ts` and
 * `swapThemeCss.ts` both handle their own load failures by degrading to the
 * previous theme and letting startup continue; reloading the page over a
 * cosmetic stylesheet would escalate that into the startup-error panel once
 * the `chunkReload` budget is spent.
 */
export function isRecoverableAppAssetFailure(
  target: EventTarget | null,
  pageLocation: PageLocation = window.location
): boolean {
  if (target instanceof HTMLScriptElement) {
    return isSameOrigin(target.src, pageLocation.href);
  }

  if (
    target instanceof HTMLLinkElement &&
    target.rel.toLowerCase() === "stylesheet" &&
    !hasAttributeSafe(target, THEME_LINK_ATTR)
  ) {
    return isSameOrigin(target.href, pageLocation.href);
  }

  return false;
}

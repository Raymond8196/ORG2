const fs = require("node:fs");
const path = require("node:path");
const {
  accountSubdomainParts,
  workerNameParts,
  workersDomainParts,
} = require("./diagnostics-host-parts.cjs");
const { pathSegments, protocolPart } = require("./diagnostics-route-parts.cjs");

function joinNonEmpty(parts, separator) {
  return parts.filter(Boolean).join(separator);
}

function defaultDiagnosticsEndpoint() {
  const workerHost = joinNonEmpty(
    [
      joinNonEmpty(workerNameParts, "-"),
      joinNonEmpty(accountSubdomainParts, ""),
      ...workersDomainParts,
    ],
    "."
  );
  return `${protocolPart}://${workerHost}/${pathSegments.join("/")}`;
}

function readPackageVersion() {
  const packagePath = path.join(__dirname, "..", "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  return typeof packageJson.version === "string" && packageJson.version.length > 0
    ? packageJson.version
    : undefined;
}

function readLocalDiagnosticsToken() {
  const localAuthPath = path.join(__dirname, "diagnostics-auth-parts.local.cjs");
  if (!fs.existsSync(localAuthPath)) {
    return undefined;
  }
  const { authTokenParts } = require(localAuthPath);
  if (!Array.isArray(authTokenParts)) {
    return undefined;
  }
  const token = authTokenParts.join("");
  return token.length > 0 ? token : undefined;
}

function applyDefaultDiagnosticsEndpoint(env) {
  if (!env.ORGII_DIAGNOSTICS_TOKEN) {
    const token = readLocalDiagnosticsToken();
    if (token) {
      env.ORGII_DIAGNOSTICS_TOKEN = token;
    }
  }
  // The default worker requires authentication. Local builds without a token
  // must keep diagnostics queued on-device instead of anonymously posting to
  // the production endpoint and surfacing a guaranteed 401 at startup.
  // An explicitly supplied endpoint remains valid for self-hosted collectors
  // that intentionally accept unauthenticated requests.
  if (!env.ORGII_DIAGNOSTICS_ENDPOINT && env.ORGII_DIAGNOSTICS_TOKEN) {
    env.ORGII_DIAGNOSTICS_ENDPOINT = defaultDiagnosticsEndpoint();
  }
  if (!env.ORGII_APP_VERSION) {
    const appVersion = readPackageVersion();
    if (appVersion) {
      env.ORGII_APP_VERSION = appVersion;
    }
  }
  return env;
}

module.exports = {
  applyDefaultDiagnosticsEndpoint,
  defaultDiagnosticsEndpoint,
  readLocalDiagnosticsToken,
  readPackageVersion,
};

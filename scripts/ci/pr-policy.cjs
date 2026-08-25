#!/usr/bin/env node

const fs = require("node:fs");

const PRIMARY_LABEL_BY_TYPE = Object.freeze({
  feat: "enhancement",
  fix: "bug",
  refactor: "refactor",
  perf: "performance",
  test: "tests",
  docs: "documentation",
  chore: "maintenance",
  build: "maintenance",
  ci: "maintenance",
  style: "maintenance",
  revert: "maintenance",
});

const PRIMARY_LABELS = Object.freeze([
  "bug",
  "enhancement",
  "refactor",
  "performance",
  "maintenance",
  "tests",
  "documentation",
]);

const AREA_LABELS = Object.freeze([
  "agent",
  "chat",
  "sessions",
  "project-management",
  "workstation",
  "cloud-collaboration",
  "frontend-ui",
  "dev-tooling",
]);

const AREA_BY_SCOPE = Object.freeze([
  [
    "agent",
    /^(agent(?:-.+)?|memory|housekeep(?:ing)?|side-query|skill|plan|codex(?:-.+)?|claude(?:-.+)?|cli-subagent|hermes|gemini|opencode.*|providers?)$/,
  ],
  [
    "chat",
    /^(chat(?:panel|-panel|-pane|-history)?|markdown|composer|canvas|terminal|browser|tooltip)$/,
  ],
  [
    "sessions",
    /^(sessions?|session-.+|history|imported-history|replay|sidebar|journey|worktree|workspace|cursor|warp)$/,
  ],
  [
    "project-management",
    /^(pm|project(?:-manager|-management)?|projects|work-items|work-management|work|orgtrack.*|routines|team-inbox|kanban|github|comments|todo|launchpad)$/,
  ],
  [
    "workstation",
    /^(workstation|source-control|lsp|code-editor|status-bar|highlight)$/,
  ],
  [
    "cloud-collaboration",
    /^(cloud|org2cloud|cloud-sync|collab|channels?|realtime|oauth|orgs|notifications?|feishu|runtime)$/,
  ],
  [
    "frontend-ui",
    /^(ui|frontend|react|components?|theme|layout|hovercard|dropdown|a11y|profile|settings(?:-.+)?|onboarding|spotlight|webview|windows|macos|app|poker)$/,
  ],
  [
    "dev-tooling",
    /^(dev|build|ci|deps|tooling|rust|quality|e2e|tests?|benchmark|diagnostics?|profiling|bundle|renderer|release|updater|lint|codegen|repo|cache|polling|streaming|ingest|perf)$/,
  ],
]);

const REQUIRED_FIRST_SECTIONS = Object.freeze([
  "Problem",
  "Solution",
  "Potential risks",
]);

const TITLE_PATTERN =
  /^(feat|fix|refactor|perf|test|docs|chore|build|ci|style|revert)\(([a-z0-9]+(?:-[a-z0-9]+)*)\): (\S.*)$/;

function parseTitle(title) {
  const match = TITLE_PATTERN.exec(title || "");
  if (!match) return null;

  const [, type, scope, summary] = match;
  return {
    type,
    scope,
    summary,
    primaryLabel: PRIMARY_LABEL_BY_TYPE[type],
  };
}

function inferAreaLabel(scope) {
  return AREA_BY_SCOPE.find(([, pattern]) => pattern.test(scope))?.[0] || null;
}

function markdownSections(body) {
  const source = body || "";
  const matches = [...source.matchAll(/^##[ \t]+(.+?)[ \t]*\r?$/gm)];

  return matches.map((match, index) => ({
    title: match[1],
    content: source.slice(
      match.index + match[0].length,
      matches[index + 1]?.index ?? source.length
    ),
  }));
}

function hasMeaningfulContent(content) {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, "").trim();
  return withoutComments.length > 0 && !/^[-_*`\s]+$/.test(withoutComments);
}

function validateDescription(body) {
  const sections = markdownSections(body);
  const errors = [];
  const firstTitles = sections.slice(0, 3).map(({ title }) => title);

  if (
    firstTitles.length !== REQUIRED_FIRST_SECTIONS.length ||
    firstTitles.some((title, index) => title !== REQUIRED_FIRST_SECTIONS[index])
  ) {
    errors.push(
      "The description must begin with ## Problem, ## Solution, and ## Potential risks in that exact order."
    );
  }

  for (const title of REQUIRED_FIRST_SECTIONS) {
    const section = sections.find((candidate) => candidate.title === title);
    if (!section || !hasMeaningfulContent(section.content)) {
      errors.push(`The ## ${title} section must contain meaningful content.`);
    }
  }

  const verification = sections.find(
    (section) => section.title === "Verification"
  );
  if (!verification || !hasMeaningfulContent(verification.content)) {
    errors.push("A non-empty ## Verification section is required.");
  }

  return errors;
}

function validateLabels(labels, parsedTitle) {
  const errors = [];
  const primary = labels.filter((label) => PRIMARY_LABELS.includes(label));
  const areas = labels.filter((label) => AREA_LABELS.includes(label));

  if (primary.length !== 1) {
    errors.push(
      `Exactly one primary label is required; found ${primary.length}: ${primary.join(", ") || "none"}.`
    );
  } else if (parsedTitle && primary[0] !== parsedTitle.primaryLabel) {
    errors.push(
      `Primary label ${primary[0]} does not match title type ${parsedTitle.type}; expected ${parsedTitle.primaryLabel}.`
    );
  }

  if (areas.length > 2) {
    errors.push(
      `No more than two area labels are allowed; found ${areas.length}: ${areas.join(", ")}.`
    );
  }

  return errors;
}

function validatePullRequest({ title, body, labels }) {
  const parsedTitle = parseTitle(title);
  const errors = [];

  if (!parsedTitle) {
    errors.push(
      "Title must use type(lowercase-kebab-scope): summary with an allowed Conventional Commit type."
    );
  }

  errors.push(...validateDescription(body));
  errors.push(...validateLabels(labels, parsedTitle));
  return errors;
}

async function githubRequest({ apiUrl, token, method = "GET", path, body }) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `GitHub API ${method} ${path} failed (${response.status}): ${detail}`
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

async function reconcileLabels({
  pullRequest,
  repository,
  token,
  apiUrl,
  request = githubRequest,
}) {
  const parsedTitle = parseTitle(pullRequest.title);
  if (!parsedTitle) {
    return pullRequest.labels.map(({ name }) => name);
  }

  const issuePath = `/repos/${repository}/issues/${pullRequest.number}`;
  const current = await request({ apiUrl, token, path: issuePath });
  const labels = new Set(current.labels.map(({ name }) => name));

  for (const label of PRIMARY_LABELS) {
    if (label !== parsedTitle.primaryLabel && labels.has(label)) {
      await request({
        apiUrl,
        token,
        method: "DELETE",
        path: `${issuePath}/labels/${encodeURIComponent(label)}`,
      });
      labels.delete(label);
    }
  }

  const toAdd = [];
  if (!labels.has(parsedTitle.primaryLabel)) {
    toAdd.push(parsedTitle.primaryLabel);
  }

  const inferredArea = inferAreaLabel(parsedTitle.scope);
  const existingAreaCount = [...labels].filter((label) =>
    AREA_LABELS.includes(label)
  ).length;
  if (inferredArea && !labels.has(inferredArea) && existingAreaCount < 2) {
    toAdd.push(inferredArea);
  }

  if (toAdd.length > 0) {
    await request({
      apiUrl,
      token,
      method: "POST",
      path: `${issuePath}/labels`,
      body: { labels: toAdd },
    });
  }

  const verified = await request({ apiUrl, token, path: issuePath });
  return verified.labels.map(({ name }) => name);
}

function workflowError(message) {
  const escaped = message
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error::${escaped}`);
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";

  if (!eventPath || !token || !repository) {
    throw new Error(
      "GITHUB_EVENT_PATH, GITHUB_TOKEN, and GITHUB_REPOSITORY are required."
    );
  }

  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (!event.pull_request) {
    throw new Error("The PR policy workflow requires a pull_request event.");
  }

  const labels = await reconcileLabels({
    pullRequest: event.pull_request,
    repository,
    token,
    apiUrl,
  });
  const errors = validatePullRequest({
    title: event.pull_request.title,
    body: event.pull_request.body || "",
    labels,
  });

  if (errors.length > 0) {
    errors.forEach(workflowError);
    process.exitCode = 1;
    return;
  }

  console.log(
    `PR #${event.pull_request.number} satisfies the tracked PR contract.`
  );
}

if (require.main === module) {
  main().catch((error) => {
    workflowError(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  AREA_LABELS,
  PRIMARY_LABELS,
  inferAreaLabel,
  markdownSections,
  parseTitle,
  reconcileLabels,
  validateDescription,
  validateLabels,
  validatePullRequest,
};

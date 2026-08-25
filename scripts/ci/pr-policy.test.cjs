const assert = require("node:assert/strict");
const test = require("node:test");

const {
  inferAreaLabel,
  parseTitle,
  reconcileLabels,
  validateDescription,
  validateLabels,
  validatePullRequest,
} = require("./pr-policy.cjs");

const VALID_BODY = `## Problem

Session replay could lose the final turn after a reconnect.

## Solution

Persist the authoritative cursor before replay resumes.

## Potential risks

Older sessions keep their existing cursor until the next successful replay.

## Verification

- \`node --test scripts/ci/*.test.cjs\` — passed
`;

test("maps every allowed title type to its primary label", () => {
  const expected = {
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
  };

  for (const [type, primaryLabel] of Object.entries(expected)) {
    assert.deepEqual(parseTitle(`${type}(session-replay): verify policy`), {
      type,
      scope: "session-replay",
      summary: "verify policy",
      primaryLabel,
    });
  }
});

test("rejects unscoped, uppercase, and malformed titles", () => {
  assert.equal(parseTitle("fix: missing scope"), null);
  assert.equal(parseTitle("Fix(session): uppercase type"), null);
  assert.equal(parseTitle("fix(Session): uppercase scope"), null);
  assert.equal(parseTitle("fix(session) missing colon"), null);
});

test("infers stable area labels from title scopes", () => {
  assert.equal(inferAreaLabel("agent-org"), "agent");
  assert.equal(inferAreaLabel("chat"), "chat");
  assert.equal(inferAreaLabel("session-creator"), "sessions");
  assert.equal(inferAreaLabel("project-management"), "project-management");
  assert.equal(inferAreaLabel("workstation"), "workstation");
  assert.equal(inferAreaLabel("org2cloud"), "cloud-collaboration");
  assert.equal(inferAreaLabel("ui"), "frontend-ui");
  assert.equal(inferAreaLabel("rust"), "dev-tooling");
  assert.equal(inferAreaLabel("unmapped-domain"), null);
});

test("accepts the required description structure and evidence", () => {
  assert.deepEqual(validateDescription(VALID_BODY), []);
});

test("rejects reordered, missing, or placeholder-only sections", () => {
  const errors = validateDescription(`## Solution

Implemented it.

## Problem

<!-- TODO -->

## Potential risks

-
`);

  assert.ok(errors.some((error) => error.includes("exact order")));
  assert.ok(errors.some((error) => error.includes("## Problem")));
  assert.ok(errors.some((error) => error.includes("## Potential risks")));
  assert.ok(errors.some((error) => error.includes("## Verification")));
});

test("requires one matching primary label and at most two areas", () => {
  const parsed = parseTitle("fix(session): preserve final turns");

  assert.deepEqual(validateLabels(["bug", "sessions"], parsed), []);
  assert.ok(validateLabels([], parsed)[0].includes("Exactly one"));
  assert.ok(
    validateLabels(["bug", "enhancement"], parsed)[0].includes("Exactly one")
  );
  assert.ok(
    validateLabels(["enhancement"], parsed)[0].includes("does not match")
  );
  assert.ok(
    validateLabels(["bug", "sessions", "chat", "agent"], parsed)[0].includes(
      "No more than two"
    )
  );
});

test("validates a complete pull request contract", () => {
  assert.deepEqual(
    validatePullRequest({
      title: "fix(session): preserve final turns",
      body: VALID_BODY,
      labels: ["bug", "sessions"],
    }),
    []
  );
});

test("reconciles the primary label and adds a scoped area", async () => {
  const labels = new Set(["bug"]);
  const calls = [];
  const request = async ({ method = "GET", path, body }) => {
    calls.push({ method, path, body });
    if (method === "DELETE") {
      labels.delete(decodeURIComponent(path.split("/").at(-1)));
    }
    if (method === "POST") {
      body.labels.forEach((label) => labels.add(label));
    }
    return { labels: [...labels].map((name) => ({ name })) };
  };

  const reconciled = await reconcileLabels({
    pullRequest: {
      number: 42,
      title: "refactor(ui): share button primitives",
      labels: [{ name: "bug" }],
    },
    repository: "org2AI/ORG2",
    token: "test-token",
    apiUrl: "https://api.github.test",
    request,
  });

  assert.deepEqual(new Set(reconciled), new Set(["refactor", "frontend-ui"]));
  assert.ok(calls.some((call) => call.method === "DELETE"));
  assert.ok(
    calls.some(
      (call) =>
        call.method === "POST" &&
        call.body.labels.includes("refactor") &&
        call.body.labels.includes("frontend-ui")
    )
  );
});

/**
 * Remove ONLY the `strokeWidth={2}` / `strokeWidth: 2` that the migration
 * agents added.
 *
 * The app ships at hugeicons' native 1.5 weight, so nothing new should pin 2.
 * But the repo already contained 215 deliberate `strokeWidth={2}` call sites
 * before any agent ran, alongside 414 at `1.75`, 75 at `1.8`, and so on — those
 * are authored choices and must survive untouched.
 *
 * So this works off the diff against the codemod checkpoint rather than
 * pattern-matching the working tree: the codemod rewrote tag names and imports
 * but never touched props, which makes that commit a faithful record of the
 * original `strokeWidth` usage. Anything added after it is agent-added.
 *
 * Usage: node scripts/hugeicons/strip-stroke-2.mjs <baseRef> [--dry]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
if (!base) {
  console.error("usage: strip-stroke-2.mjs <baseRef> [--dry]");
  process.exit(1);
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });

const files = git("diff", "--name-only", base, "--", "src")
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f));

const IS_TWO = /strokeWidth(=\{2\}|:\s*2\b)/;

let touched = 0;
let removed = 0;

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  // -U0 so every hunk header gives exact new-file line numbers
  const diff = git("diff", "-U0", base, "--", file);
  const addedLines = new Set();
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      newLine = Number(h[1]);
      continue;
    }
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      if (IS_TWO.test(line)) addedLines.add(newLine);
      newLine++;
    }
  }
  if (!addedLines.size) continue;

  const src = fs.readFileSync(file, "utf8").split("\n");
  const out = [];
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const lineNo = i + 1;
    if (!addedLines.has(lineNo) || !IS_TWO.test(src[i])) {
      out.push(src[i]);
      continue;
    }
    // whole-line attribute (prettier's usual shape) -> drop the line
    if (/^\s*strokeWidth(=\{2\}|:\s*2,?)\s*$/.test(src[i])) {
      n++;
      continue;
    }
    // inline attribute -> excise just the attribute
    const next = src[i]
      .replace(/\s*strokeWidth=\{2\}/, "")
      .replace(/\s*strokeWidth:\s*2,/, "")
      .replace(/,\s*strokeWidth:\s*2\b/, "");
    if (next !== src[i]) n++;
    out.push(next);
  }
  if (n) {
    if (!dry) fs.writeFileSync(file, out.join("\n"));
    touched++;
    removed += n;
  }
}

console.log(
  `${dry ? "[dry] " : ""}removed ${removed} agent-added strokeWidth=2 across ${touched} files`,
);

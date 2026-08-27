/**
 * Remove the `type LucideIcon = IconSvgElement;` shims the codemod left behind.
 *
 * These typecheck fine — the alias is structurally correct — but they leave
 * lucide's vocabulary scattered through a codebase that no longer depends on
 * it, so the next reader has to learn a name that means nothing any more.
 *
 * Usage: node scripts/hugeicons/drop-lucide-aliases.mjs <root> [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const ALIAS = /^[ \t]*type\s+Lucide(?:Icon|Props)\s*=\s*IconSvgElement;[ \t]*\r?\n/gm;
const USES = /\bLucide(?:Icon|Props)\b/g;
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@hugeicons\/react["'];/;

function collect(root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      collect(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
if (!root) {
  console.error("usage: drop-lucide-aliases.mjs <root> [--dry]");
  process.exit(1);
}

let files = 0;
const orphans = [];

for (const file of collect(path.resolve(root))) {
  let text = fs.readFileSync(file, "utf8");
  if (!ALIAS.test(text)) continue;
  ALIAS.lastIndex = 0;

  text = text.replace(ALIAS, "");
  text = text.replace(USES, "IconSvgElement");
  // collapse the blank line the removed alias may have left behind
  text = text.replace(/\n{3,}/g, "\n\n");

  // make sure IconSvgElement is actually imported as a type
  const m = text.match(IMPORT);
  if (m) {
    if (!/\bIconSvgElement\b/.test(m[1])) {
      const names = m[1].trim().replace(/,$/, "");
      text = text.replace(
        IMPORT,
        `import { ${names}${names ? ", " : ""}type IconSvgElement } from "@hugeicons/react";`,
      );
    }
  } else {
    orphans.push(file);
  }

  if (!dry) fs.writeFileSync(file, text);
  files++;
}

console.log(`${dry ? "[dry] " : ""}cleaned ${files} files`);
if (orphans.length) {
  console.log(`  ${orphans.length} had no @hugeicons/react import — check by hand:`);
  for (const o of orphans) console.log(`    ${o}`);
}

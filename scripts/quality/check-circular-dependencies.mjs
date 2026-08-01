#!/usr/bin/env node

import madge from "madge";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..", "..");
const JSON_OUTPUT = process.argv.includes("--json");
const STYLE_EXTENSION = /\.(?:css|less|sass|scss|styl)$/i;
const LOCAL_SPECIFIER = /^(?:\.{1,2}[\\/]|[\\/])/;

function isResolvableExternalSpecifier(specifier) {
  if (LOCAL_SPECIFIER.test(specifier)) return false;

  try {
    const resolved = import.meta.resolve(specifier);
    if (resolved.startsWith("node:")) return true;
    return resolved.startsWith("file:") && existsSync(fileURLToPath(resolved));
  } catch {
    return false;
  }
}

function printCycles(cycles) {
  console.error(
    `Found ${cycles.length} circular dependenc${cycles.length === 1 ? "y" : "ies"}:`
  );
  for (const cycle of cycles) {
    console.error(`  ${[...cycle, cycle[0]].join(" -> ")}`);
  }
}

const madgeConfig = JSON.parse(readFileSync(join(ROOT, ".madgerc"), "utf8"));
const result = await madge(join(ROOT, "src"), {
  ...madgeConfig,
  fileExtensions: ["ts", "tsx"],
  tsConfig: join(ROOT, "tsconfig.json"),
  // Stylesheets are leaves in the TypeScript graph. Traversing them makes
  // detective-scss misread keyframes and Tailwind directives as imports.
  dependencyFilter: (dependencyPath) => !STYLE_EXTENSION.test(dependencyPath),
});

const cycles = result.circular();
const skipped = result.warnings().skipped;
const unresolved = skipped.filter(
  (specifier) => !isResolvableExternalSpecifier(specifier)
);

if (JSON_OUTPUT) {
  console.log(JSON.stringify(cycles));
} else if (cycles.length === 0 && unresolved.length === 0) {
  console.log(
    `No circular dependencies found across ${Object.keys(result.obj()).length} modules.`
  );
}

if (unresolved.length > 0) {
  console.error(
    `Madge could not resolve ${unresolved.length} source import${unresolved.length === 1 ? "" : "s"}:`
  );
  for (const specifier of unresolved) console.error(`  ${specifier}`);
}

if (cycles.length > 0 && !JSON_OUTPUT) printCycles(cycles);
if (cycles.length > 0 || unresolved.length > 0) process.exitCode = 1;

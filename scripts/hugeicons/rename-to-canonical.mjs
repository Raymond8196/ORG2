/**
 * Rename icon locals to their canonical hugeicons glyph name.
 *
 * The migration kept lucide's names (`Search`, `AlertTriangle`) bound to
 * hugeicons glyphs (`Search01Icon`, `Alert01Icon`). That mismatch is the only
 * reason this repo cannot use the concise barrel form: a build-time transform
 * rewrites `{ Search }` to `.../Search`, which does not exist — only the
 * canonical filename does.
 *
 * Renaming the local to match the file makes local === export === filename, so
 * `@swc/plugin-transform-imports` can rewrite concise imports to deep ones and
 * we get short source AND no 672 KB barrel parse.
 *
 * Scope is deliberately narrow: the import's local binding and its references
 * inside the same file. `data-icon` values are string literals and are NOT
 * touched, so every DOM assertion keeps working.
 *
 * Usage: node scripts/hugeicons/rename-to-canonical.mjs [--dry]
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const dry = process.argv.includes("--dry");
const PKG = "@hugeicons/core-free-icons/";

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

let files = 0;
let renames = 0;
const collisions = [];

for (const file of collect(path.resolve("src"))) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(PKG)) continue;

  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** local -> canonical, for locals that need renaming */
  const plan = new Map();
  const takenNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!st.moduleSpecifier.text.startsWith(PKG)) continue;
    const local = st.importClause?.name?.text;
    if (!local) continue;
    const canonical = st.moduleSpecifier.text.slice(PKG.length);
    takenNames.add(canonical);
    if (local !== canonical) plan.set(local, canonical);
  }
  if (!plan.size) continue;

  // Two locals in one file can point at the SAME glyph (e.g. Chrome and
  // Chromium both -> InternetIcon). Renaming both would collide, so leave the
  // whole file alone and report it rather than produce a duplicate identifier.
  const targets = [...plan.values()];
  if (new Set(targets).size !== targets.length) {
    collisions.push({ file: path.relative(process.cwd(), file), targets });
    continue;
  }
  // A canonical name already used by a DIFFERENT binding in this file is also
  // a collision risk.
  let unsafe = false;
  for (const [local, canonical] of plan) {
    const re = new RegExp(`\\b${canonical}\\b`);
    if (re.test(text) && canonical !== local) {
      const usedElsewhere = [...plan.keys()].some((k) => k === canonical);
      if (!usedElsewhere && new RegExp(`\\b${canonical}\\b`).test(text)) {
        // canonical already appears (maybe as another import or identifier)
        const importedAs = [...plan.values()].filter((v) => v === canonical);
        if (importedAs.length > 1) unsafe = true;
      }
    }
  }
  if (unsafe) {
    collisions.push({ file: path.relative(process.cwd(), file), targets });
    continue;
  }

  // A shorthand property (`{ Layers }`) uses the identifier AS the object key,
  // so renaming it silently changes the key — and any `keyof typeof` union
  // built from it drifts away from the string values that index it. Skip the
  // file rather than guess whether the key is load-bearing.
  let shorthandRisk = false;
  const scanShorthand = (n) => {
    if (
      ts.isShorthandPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      plan.has(n.name.text)
    ) {
      shorthandRisk = true;
    }
    ts.forEachChild(n, scanShorthand);
  };
  scanShorthand(sf);
  if (shorthandRisk) {
    collisions.push({ file: path.relative(process.cwd(), file), targets });
    continue;
  }

  // The canonical name may already be declared in this file (e.g. a local
  // `DatabaseIcon` component alongside an import of the DatabaseIcon glyph).
  let declaredClash = false;
  const scanDecls = (n) => {
    if (
      (ts.isVariableDeclaration(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isClassDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name) &&
      targets.includes(n.name.text)
    ) {
      declaredClash = true;
    }
    ts.forEachChild(n, scanDecls);
  };
  scanDecls(sf);
  if (declaredClash) {
    collisions.push({ file: path.relative(process.cwd(), file), targets });
    continue;
  }

  // Rename by identifier node so strings, comments and JSX text are untouched.
  const edits = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && plan.has(node.text)) {
      // skip the property side of `foo.Search` and object keys `{ Search: x }`
      const p = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isPropertySignature(p) && p.name === node);
      if (!isPropertyName) {
        edits.push({
          start: node.getStart(sf),
          end: node.getEnd(),
          text: plan.get(node.text),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;

  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  if (!dry) fs.writeFileSync(file, out);
  files++;
  renames += edits.length;
}

console.log(
  `${dry ? "[dry] " : ""}renamed ${renames} identifiers across ${files} files`,
);
if (collisions.length) {
  console.log(`\n${collisions.length} files skipped (two locals share a glyph):`);
  for (const c of collisions.slice(0, 15)) {
    console.log(`  ${c.file}`);
  }
}

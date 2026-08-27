/**
 * Rewrite `createElement(<glyph>, props)` to `createElement(HugeiconsIcon, { icon: <glyph>, ...props })`.
 *
 * The main codemod only rewrote JSX (`<Search />`), so imperative icon
 * construction slipped through. Those sites live mostly in `.ts` option/config
 * modules that build `ReactNode` values by hand.
 *
 * This class of bug survived `tsc --noEmit` because the receiving props are
 * typed `ReactNode`, and hugeicons glyph data is a nested ARRAY — which is a
 * structurally valid `ReactNode`. TypeScript is satisfied; React then tries to
 * render `["path", {...}]` as an element and throws
 * "Element type is invalid ... but got: object" at runtime.
 *
 * Usage: node scripts/hugeicons/fix-create-element.mjs <root> [--dry]
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ICON_PKG = "@hugeicons/core-free-icons/";

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
  console.error("usage: fix-create-element.mjs <root> [--dry]");
  process.exit(1);
}

let files = 0;
let fixed = 0;

for (const file of collect(path.resolve(root))) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("core-free-icons") || !text.includes("createElement")) {
    continue;
  }

  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** local names bound to a hugeicons glyph module */
  const glyphs = new Set();
  let hasRenderer = false;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (spec.startsWith(ICON_PKG) && st.importClause?.name) {
      glyphs.add(st.importClause.name.text);
    }
    if (spec === "@hugeicons/react" && /HugeiconsIcon/.test(st.getText())) {
      hasRenderer = true;
    }
  }
  if (!glyphs.size) continue;

  const edits = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      /(^|\.)createElement$/.test(node.expression.getText())
    ) {
      const [type, props] = node.arguments;
      if (type && ts.isIdentifier(type) && glyphs.has(type.text)) {
        let nextProps;
        if (!props) {
          nextProps = `{ icon: ${type.text} }`;
        } else if (ts.isObjectLiteralExpression(props)) {
          const inner = props.properties.map((p) => p.getText(sf)).join(", ");
          nextProps = inner
            ? `{ icon: ${type.text}, ${inner} }`
            : `{ icon: ${type.text} }`;
        } else {
          nextProps = `{ icon: ${type.text}, ...${props.getText(sf)} }`;
        }
        edits.push({
          start: type.getStart(sf),
          end: props ? props.getEnd() : type.getEnd(),
          text: `HugeiconsIcon, ${nextProps}`,
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

  if (!hasRenderer) {
    const lines = out.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ")) {
        lines.splice(i, 0, 'import { HugeiconsIcon } from "@hugeicons/react";');
        break;
      }
    }
    out = lines.join("\n");
  }

  if (!dry) fs.writeFileSync(file, out);
  files++;
  fixed += edits.length;
}

console.log(`${dry ? "[dry] " : ""}rewrote ${fixed} createElement calls in ${files} files`);

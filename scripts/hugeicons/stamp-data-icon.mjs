/**
 * Stamp `data-icon="<name>"` onto every static HugeiconsIcon call site.
 *
 * Lucide put `class="lucide lucide-chevron-down"` on every icon it rendered,
 * and ~120 assertions across 46 unit-test files plus 4 e2e selectors came to
 * depend on that. `HugeiconsIcon` renders `class=""`, so all of them break —
 * and the e2e refresh selector breaks *silently*, degrading to a no-op.
 *
 * Rather than hand-editing every assertion, this restores the capability the
 * tests were relying on. `data-icon` is honest about what it is (we are not
 * lucide), and it is one attribute where lucide wrote two classes, so the
 * rendered DOM is strictly lighter than before.
 *
 * The name is the kebab-cased local identifier, which the codemod preserved
 * from the original lucide import — so `<HugeiconsIcon icon={ChevronDown} />`
 * gets `data-icon="chevron-down"`, matching lucide's old class for all but a
 * handful of icons lucide itself renamed (XCircle -> circle-x, and similar).
 *
 * Dynamic icons (`icon={item.icon}`) have no name available and are skipped.
 *
 * Usage: node scripts/hugeicons/stamp-data-icon.mjs <root> [--dry]
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

/** Matches lucide's toKebabCase: hyphenate before caps and before digit runs. */
function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
}

function collect(root, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      collect(p, out);
    } else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
if (!root) {
  console.error("usage: stamp-data-icon.mjs <root> [--dry]");
  process.exit(1);
}

let files = 0;
let stamped = 0;
let skipped = 0;

for (const file of collect(path.resolve(root))) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("HugeiconsIcon")) continue;

  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // Only identifiers bound to a hugeicons glyph module get stamped. Without
  // this check, a dynamic `icon={icon}` is also an identifier and would be
  // stamped `data-icon="icon"` — a name that means nothing.
  const glyphs = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!st.moduleSpecifier.text.startsWith("@hugeicons/core-free-icons/")) {
      continue;
    }
    if (st.importClause?.name) glyphs.add(st.importClause.name.text);
  }

  const edits = [];

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && tag.text === "HugeiconsIcon") {
        const attrs = node.attributes.properties;
        const has = attrs.some(
          (a) => ts.isJsxAttribute(a) && a.name.getText() === "data-icon",
        );
        const iconAttr = attrs.find(
          (a) => ts.isJsxAttribute(a) && a.name.getText() === "icon",
        );
        if (!has && iconAttr && ts.isJsxAttribute(iconAttr)) {
          const init = iconAttr.initializer;
          if (init && ts.isJsxExpression(init) && init.expression) {
            const expr = init.expression;
            if (ts.isIdentifier(expr) && glyphs.has(expr.text)) {
              edits.push({
                pos: iconAttr.getEnd(),
                text: ` data-icon="${kebab(expr.text)}"`,
              });
            } else {
              skipped++;
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) continue;
  let out = text;
  for (const e of [...edits].sort((a, b) => b.pos - a.pos)) {
    out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  }
  if (!dry) fs.writeFileSync(file, out);
  files++;
  stamped += edits.length;
}

console.log(
  `${dry ? "[dry] " : ""}stamped ${stamped} call sites in ${files} files ` +
    `(${skipped} dynamic icons skipped)`,
);

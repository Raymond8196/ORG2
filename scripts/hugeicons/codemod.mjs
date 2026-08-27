/**
 * lucide-react -> hugeicons codemod.
 *
 * Text-range based: we compute edits against the original source and apply them
 * back-to-front, so formatting, comments and blank lines survive untouched.
 * The TypeScript AST is used only to *locate* things, never to reprint them.
 *
 * Usage:
 *   node scripts/hugeicons/codemod.mjs <glob-root> [--dry] [--report=path.json]
 *
 * Exit codes: 0 = clean, 1 = hard failure, 2 = completed with flagged files.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(
  fs.readFileSync(path.join(HERE, "icon-map.json"), "utf8"),
);

const LUCIDE = "lucide-react";
const RENDERER = '"@hugeicons/react"';
const ICON_PKG = "@hugeicons/core-free-icons";

/** Walk a directory collecting .ts/.tsx files. */
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

function parse(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * @returns {{edits: Array<{start:number,end:number,text:string}>, flags: string[]}}
 */
function processFile(file, text) {
  const sf = parse(file, text);
  const edits = [];
  const flags = [];

  /** local name -> {imported, typeOnly} */
  const locals = new Map();

  // ---- pass 1: gather every lucide import, file-wide --------------------
  // Collected up front so the renderer/type import is emitted exactly ONCE
  // per file even when a file has several `from "lucide-react"` statements.
  const decls = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.moduleSpecifier.text !== LUCIDE) continue;

    const clause = st.importClause;
    if (!clause) {
      flags.push("side-effect import of lucide-react");
      continue;
    }
    if (clause.name) {
      flags.push(`default import from lucide-react (${clause.name.text})`);
      continue;
    }
    const nb = clause.namedBindings;
    if (!nb || !ts.isNamedImports(nb)) {
      flags.push("namespace import from lucide-react");
      continue;
    }
    decls.push({ st, nb, declTypeOnly: clause.isTypeOnly });
  }
  if (!decls.length) return { edits: [], flags };

  let needsRenderer = false;
  let needsSvgElementType = false;
  const typeAliases = new Set();

  for (const d of decls) {
    d.iconLines = [];
    for (const spec of d.nb.elements) {
      const local = spec.name.text;
      const imported = spec.propertyName ? spec.propertyName.text : local;
      const typeOnly = d.declTypeOnly || spec.isTypeOnly;

      if (imported === "LucideIcon" || imported === "LucideProps") {
        needsSvgElementType = true;
        if (local !== "IconSvgElement") typeAliases.add(local);
        continue;
      }
      if (imported === "createLucideIcon") {
        flags.push("uses createLucideIcon — hand-port required");
        continue;
      }
      const entry = MAP[imported];
      if (!entry || !entry.target) {
        flags.push(`no mapping for ${imported}`);
        continue;
      }
      locals.set(local, { imported, typeOnly });
      d.iconLines.push(`import ${local} from "${ICON_PKG}/${entry.target}";`);
      if (!typeOnly) needsRenderer = true;
    }
  }

  // ---- emit: renderer import rides on the FIRST lucide declaration ------
  decls.forEach((d, i) => {
    const out = [];
    if (i === 0 && (needsRenderer || needsSvgElementType)) {
      const bits = [];
      if (needsRenderer) bits.push("HugeiconsIcon");
      if (needsSvgElementType) bits.push("type IconSvgElement");
      out.push(`import { ${bits.join(", ")} } from ${RENDERER};`);
    }
    out.push(...d.iconLines.sort());
    if (i === 0) {
      for (const t of [...typeAliases].sort()) {
        out.push(`type ${t} = IconSvgElement;`);
      }
    }
    edits.push({
      start: d.st.getStart(sf),
      end: d.st.getEnd(),
      // an emptied declaration collapses to nothing rather than a blank import
      text: out.join("\n"),
    });
  });

  // ---- pass 2: JSX call sites -----------------------------------------
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && locals.has(tag.text)) {
        const name = tag.text;
        edits.push({
          start: tag.getStart(sf),
          end: tag.getEnd(),
          text: `HugeiconsIcon icon={${name}}`,
        });
        if (ts.isJsxOpeningElement(node)) {
          const parent = node.parent;
          if (ts.isJsxElement(parent)) {
            const close = parent.closingElement.tagName;
            edits.push({
              start: close.getStart(sf),
              end: close.getEnd(),
              text: "HugeiconsIcon",
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { edits, flags };
}

function apply(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const e of sorted) {
    if (e.end > lastStart) {
      throw new Error(`overlapping edit at ${e.start}-${e.end}`);
    }
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

// ---- main --------------------------------------------------------------
const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
const reportArg = args.find((a) => a.startsWith("--report="));

if (!root) {
  console.error("usage: codemod.mjs <root> [--dry] [--report=out.json]");
  process.exit(1);
}

const report = { changed: [], flagged: [], skipped: 0, errors: [] };

for (const file of collect(path.resolve(root))) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(LUCIDE)) {
    report.skipped++;
    continue;
  }
  try {
    const { edits, flags } = processFile(file, text);
    if (flags.length) report.flagged.push({ file, flags });
    if (!edits.length) continue;
    const next = apply(text, edits);
    if (next !== text) {
      if (!dry) fs.writeFileSync(file, next);
      report.changed.push({ file, edits: edits.length });
    }
  } catch (err) {
    report.errors.push({ file, error: String(err.message ?? err) });
  }
}

console.log(
  `changed ${report.changed.length} · flagged ${report.flagged.length} · ` +
    `errors ${report.errors.length} · skipped ${report.skipped}`,
);
for (const e of report.errors) console.error(`  ERROR ${e.file}: ${e.error}`);

if (reportArg) {
  fs.writeFileSync(reportArg.slice("--report=".length), JSON.stringify(report, null, 2));
}
process.exit(report.errors.length ? 1 : report.flagged.length ? 2 : 0);

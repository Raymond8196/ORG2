/**
 * Rewrite `<Glyph ... />` to `<HugeiconsIcon icon={Glyph} ... />` wherever the
 * type checker proves the tag is glyph DATA rather than a component.
 *
 * The original codemod worked per-file off `lucide-react` imports, so it never
 * saw files that receive glyphs indirectly — e.g.
 * `const { filter: FilterIcon } = ICON_CONFIG`, where the glyph is imported in
 * a sibling config module. Those files contain no lucide reference at all.
 *
 * Detection is by type, not by name: `IconSvgElement` is an array and no React
 * component ever is. Names are useless here — `<IconTabStrip />` is a real
 * component and `<Icon />` could be either.
 *
 * Usage: node scripts/hugeicons/fix-glyph-as-component.mjs [--dry]
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const dry = process.argv.includes("--dry");

const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

function isGlyphData(type) {
  if (!type) return false;
  if (checker.isArrayType(type) || checker.isTupleType(type)) return true;
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
  if (name && /^IconSvg(Element|Object)$/.test(name)) return true;
  if (type.isUnion()) return type.types.some(isGlyphData);
  return false;
}

const byFile = new Map();

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!sf.fileName.startsWith(path.join(cwd, "src"))) continue;

  const edits = [];
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName;
      if (
        ts.isIdentifier(tag) &&
        /^[A-Z]/.test(tag.text) &&
        tag.text !== "HugeiconsIcon" &&
        isGlyphData(checker.getTypeAtLocation(tag))
      ) {
        edits.push({
          start: tag.getStart(sf),
          end: tag.getEnd(),
          text: `HugeiconsIcon icon={${tag.text}}`,
        });
        if (ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent)) {
          const close = node.parent.closingElement.tagName;
          edits.push({
            start: close.getStart(sf),
            end: close.getEnd(),
            text: "HugeiconsIcon",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (edits.length) byFile.set(sf.fileName, edits);
}

let total = 0;
for (const [file, edits] of byFile) {
  let text = fs.readFileSync(file, "utf8");
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  }
  if (!/from "@hugeicons\/react"/.test(text)) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ")) {
        lines.splice(i, 0, 'import { HugeiconsIcon } from "@hugeicons/react";');
        break;
      }
    }
    text = lines.join("\n");
  } else if (!/HugeiconsIcon/.test(text.split("\n").filter((l) => l.startsWith("import")).join("\n"))) {
    text = text.replace(
      /import \{([^}]*)\} from "@hugeicons\/react";/,
      (m, inner) => `import { HugeiconsIcon,${inner}} from "@hugeicons/react";`,
    );
  }
  if (!dry) fs.writeFileSync(file, text);
  total += edits.length;
  console.log(`${path.relative(cwd, file)}  (${edits.length})`);
}
console.log(`\n${dry ? "[dry] " : ""}rewrote ${total} sites in ${byFile.size} files`);

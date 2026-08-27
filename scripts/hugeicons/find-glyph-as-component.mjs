/**
 * Find every place hugeicons glyph DATA is used where React expects a COMPONENT.
 *
 * Name-matching heuristics are not good enough here: `<IconTabStrip />` is a
 * real component and `<Icon />` may or may not be glyph data depending on what
 * it was bound to. So this builds a real ts.Program and asks the type checker
 * whether the tag's type is an array — which is what `IconSvgElement` is, and
 * what no React component ever is.
 *
 * This is the detector for the migration's sharpest failure mode: glyph data is
 * a nested array, arrays satisfy `ReactNode`, so these sites typecheck clean and
 * then throw "Element type is invalid ... but got: object" at runtime.
 *
 * Usage: node scripts/hugeicons/find-glyph-as-component.mjs [--json]
 */
import ts from "typescript";
import path from "node:path";

const cwd = process.cwd();
const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
if (!configPath) {
  console.error("no tsconfig.json found");
  process.exit(1);
}
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));

const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/** IconSvgElement is `readonly (readonly [string, {...}])[]`; components never are. */
function isGlyphData(type) {
  if (!type) return false;
  if (checker.isArrayType(type) || checker.isTupleType(type)) return true;
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
  if (name && /^IconSvg(Element|Object)$/.test(name)) return true;
  if (type.isUnion()) return type.types.some(isGlyphData);
  return false;
}

const findings = [];

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!sf.fileName.startsWith(path.join(cwd, "src"))) continue;

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)) {
        const type = checker.getTypeAtLocation(tag);
        if (isGlyphData(type)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          findings.push({
            file: path.relative(cwd, sf.fileName),
            line: line + 1,
            tag: tag.text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  for (const f of findings) console.log(`${f.file}:${f.line}  <${f.tag} ... />`);
  console.log(`\nTOTAL glyph-data-as-component: ${findings.length}`);
}
process.exit(findings.length ? 2 : 0);

/**
 * Find every place hugeicons glyph DATA is rendered as a React COMPONENT.
 *
 * This is the migration's sharpest failure mode. `IconSvgElement` is a nested
 * array; arrays satisfy `ReactNode`; so these sites typecheck clean and then
 * throw "Element type is invalid ... but got: array" at runtime.
 *
 * Detection needs BOTH strategies below, because neither is sufficient alone:
 *
 *   1. TYPE — ask the checker whether a JSX tag's type is glyph data. Note that
 *      `checker.isArrayType()` matches only mutable `Array<T>`; `IconSvgElement`
 *      is a READONLY array, so that alone misses most real cases.
 *
 *   2. SYNTAX — the checker reports `any` for props of components written as
 *      `const C: React.FC<P> = React.memo(({ ... }) => ...)`, because the props
 *      type does not propagate through `memo` here. In those files `tsc` accepts
 *      anything, so types tell us nothing and we must trace bindings by hand:
 *        - `import Plus from "@hugeicons/core-free-icons/Add01Icon"`  -> glyph
 *        - `{ addIcon: AddIcon = Plus }`  (destructured default is a glyph)
 *        - `{ addIcon: AddIcon }` where the component's props interface declares
 *          `addIcon?: IconSvgElement`
 *
 * Strategy 2 is what catches SidebarBase, which strategy 1 could never see.
 *
 * Usage: node scripts/hugeicons/find-glyph-as-component.mjs [--json]
 * Exits non-zero when anything is found, so it can gate CI.
 */
import ts from "typescript";
import path from "node:path";

const cwd = process.cwd();
const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const GLYPH_MODULE = "@hugeicons/core-free-icons/";

function isGlyphType(type, depth = 0) {
  if (!type || depth > 3) return false;
  if (checker.isArrayType(type) || checker.isTupleType(type)) return true;
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
  if (name && /^(IconSvg(Element|Object)|ReadonlyArray)$/.test(name)) return true;
  const text = checker.typeToString(type);
  if (/^IconSvg(Element|Object)$/.test(text)) return true;
  if (/^readonly .+\[\]$/.test(text)) return true;
  if (type.isUnion()) return type.types.some((t) => isGlyphType(t, depth + 1));
  return false;
}

/** Members of a props interface that are declared as glyph data. */
function glyphPropsOf(typeNode) {
  const out = new Set();
  if (!typeNode) return out;
  const type = checker.getTypeFromTypeNode(typeNode);
  for (const prop of checker.getPropertiesOfType(type)) {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!decl) continue;
    const t = checker.getTypeOfSymbolAtLocation(prop, decl);
    if (isGlyphType(t)) out.add(prop.getName());
  }
  return out;
}

const findings = [];

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!sf.fileName.startsWith(path.join(cwd, "src"))) continue;

  // --- names bound to glyph data, by syntax ---------------------------------
  const glyphNames = new Set();
  for (const st of sf.statements) {
    if (
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text.startsWith(GLYPH_MODULE) &&
      st.importClause?.name
    ) {
      glyphNames.add(st.importClause.name.text);
    }
  }

  const collect = (node) => {
    // const C: React.FC<Props> = ... ({ icon: Icon = Glyph, other: O })
    if (ts.isVariableDeclaration(node) && node.initializer) {
      let propsGlyphs = new Set();
      if (node.type && ts.isTypeReferenceNode(node.type) && node.type.typeArguments?.[0]) {
        propsGlyphs = glyphPropsOf(node.type.typeArguments[0]);
      }
      const scanParams = (fn) => {
        for (const p of fn.parameters ?? []) {
          if (!p.name || !ts.isObjectBindingPattern(p.name)) continue;
          for (const el of p.name.elements) {
            if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) continue;
            const local = el.name.text;
            const declared = el.propertyName?.getText(sf) ?? local;
            const defaultIsGlyph =
              el.initializer &&
              ts.isIdentifier(el.initializer) &&
              glyphNames.has(el.initializer.text);
            if (defaultIsGlyph || propsGlyphs.has(declared)) glyphNames.add(local);
          }
        }
      };
      const init = node.initializer;
      const inner =
        ts.isCallExpression(init) && init.arguments[0] ? init.arguments[0] : init;
      if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) scanParams(inner);
    }
    // const X = <glyph>   |   const { a: X } = <obj>  — handled loosely
    if (
      ts.isVariableDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      glyphNames.has(node.initializer.text)
    ) {
      glyphNames.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  // --- flag JSX tags ---------------------------------------------------------
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text) && tag.text !== "HugeiconsIcon") {
        const byType = isGlyphType(checker.getTypeAtLocation(tag));
        const bySyntax = glyphNames.has(tag.text);
        if (byType || bySyntax) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          findings.push({
            file: path.relative(cwd, sf.fileName),
            line: line + 1,
            tag: tag.text,
            how: byType ? "type" : "syntax",
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
  for (const f of findings) {
    console.log(`${f.file}:${f.line}  <${f.tag} ... />   [${f.how}]`);
  }
  console.log(`\nTOTAL glyph-data-as-component: ${findings.length}`);
}
process.exit(findings.length ? 2 : 0);

/**
 * Route DYNAMIC icon renders through AnyIcon instead of HugeiconsIcon.
 *
 * `<HugeiconsIcon icon={Search} />` (a static glyph import) is left alone — it
 * cannot be undefined and needs no indirection. Everything else — registry
 * lookups, props, ternaries — goes through AnyIcon, which renders null on a
 * missing icon rather than throwing and destroying the whole render tree.
 */
import ts from "typescript"; import fs from "node:fs"; import path from "node:path";
function collect(r,o=[]){for(const e of fs.readdirSync(r,{withFileTypes:true})){const p=path.join(r,e.name);
 if(e.isDirectory()){if(e.name==="node_modules"||e.name===".git")continue;collect(p,o);}else if(/\.tsx?$/.test(e.name))o.push(p);}return o;}
const dry=process.argv.includes("--dry");
let files=0,sites=0;
for(const f of collect(path.resolve("src"))){
  if(f.endsWith("AnyIcon.tsx"))continue;
  const text=fs.readFileSync(f,"utf8");
  if(!text.includes("HugeiconsIcon"))continue;
  const sf=ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true,f.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const glyphs=new Set();
  for(const st of sf.statements)
    if(ts.isImportDeclaration(st)&&ts.isStringLiteral(st.moduleSpecifier)&&st.moduleSpecifier.text.startsWith("@hugeicons/core-free-icons/")&&st.importClause?.name)
      glyphs.add(st.importClause.name.text);
  const edits=[];
  const visit=(n)=>{
    if((ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&ts.isIdentifier(n.tagName)&&n.tagName.text==="HugeiconsIcon"){
      for(const a of n.attributes.properties){
        if(!ts.isJsxAttribute(a)||a.name.getText()!=="icon")continue;
        const init=a.initializer;
        if(!init||!ts.isJsxExpression(init)||!init.expression)continue;
        const e=init.expression;
        if(ts.isIdentifier(e)&&glyphs.has(e.text))continue; // static, safe
        edits.push({start:n.tagName.getStart(sf),end:n.tagName.getEnd(),text:"AnyIcon"});
        if(ts.isJsxOpeningElement(n)&&ts.isJsxElement(n.parent)){
          const c=n.parent.closingElement.tagName;
          edits.push({start:c.getStart(sf),end:c.getEnd(),text:"AnyIcon"});
        }
      }
    }
    ts.forEachChild(n,visit);
  };
  visit(sf);
  if(!edits.length)continue;
  let out=text;
  for(const e of [...edits].sort((a,b)=>b.start-a.start)) out=out.slice(0,e.start)+e.text+out.slice(e.end);
  if(!/from "@src\/components\/AnyIcon"/.test(out)){
    const L=out.split("\n");
    for(let i=0;i<L.length;i++){ if(L[i].startsWith("import ")){L.splice(i,0,'import AnyIcon from "@src/components/AnyIcon";');break;} }
    out=L.join("\n");
  }
  if(!dry)fs.writeFileSync(f,out);
  files++; sites+=edits.length;
}
console.log(`${dry?"[dry] ":""}routed ${sites} dynamic sites in ${files} files to AnyIcon`);

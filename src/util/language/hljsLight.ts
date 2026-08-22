/**
 * highlight.js core with an explicit language set.
 *
 * `import hljs from "highlight.js"` is the "all languages" build: ~190
 * language modules registered at import time, most of which the diff views
 * never ask for. `highlight.js/lib/core` starts empty; the languages below
 * cover everything `src/config/languageMap.ts` can produce that highlight.js
 * knows. Names it does not know ("shellscript", "typescriptreact", "hcl",
 * ...) throw inside `hljs.highlight`, exactly as they did with the full
 * build, and every caller already catches that and falls back to escaped
 * text — so the visible behaviour is unchanged.
 *
 * Aliases (`html`/`xhtml` → xml, `ts` → typescript, `sh`/`zsh` → bash,
 * `yml` → yaml, `toml` → ini, ...) are declared by the language modules.
 */
import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import clojure from "highlight.js/lib/languages/clojure";
import cmake from "highlight.js/lib/languages/cmake";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import elm from "highlight.js/lib/languages/elm";
import erlang from "highlight.js/lib/languages/erlang";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import objectivec from "highlight.js/lib/languages/objectivec";
import ocaml from "highlight.js/lib/languages/ocaml";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import vim from "highlight.js/lib/languages/vim";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

import scss from "highlight.js/lib/languages/scss";

/** Language name → definition. Keys are highlight.js canonical names. */
const HLJS_LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  clojure,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  elm,
  erlang,
  go,
  graphql,
  haskell,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  objectivec,
  ocaml,
  perl,
  php,
  plaintext,
  powershell,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  shell,
  sql,
  swift,
  typescript,
  vim,
  xml,
  yaml,
};

for (const [name, definition] of Object.entries(HLJS_LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

/** Registered highlight.js language names (canonical names, no aliases). */
export const HLJS_LIGHT_LANGUAGES: readonly string[] =
  Object.keys(HLJS_LANGUAGES);

/** Drop-in replacement for the default export of "highlight.js". */
export { hljs };

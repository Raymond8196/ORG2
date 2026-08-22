/**
 * Prism highlighter (react-syntax-highlighter) with an explicit grammar set.
 *
 * `import { Prism } from "react-syntax-highlighter"` resolves through the
 * package barrel, which statically imports every refractor grammar (~280
 * modules) plus the highlight.js build and the async-loader variants. In the
 * webpack dev graph that was ~470 modules compiled and cached on every
 * build for grammars the app never renders.
 *
 * The light entry starts empty; only the grammars registered below exist.
 * Everything the app's language mappers can produce that Prism knows
 * (`src/config/languageMap.ts`, `src/util/editor/extension.tsx`, markdown
 * fence info strings) is covered. An unregistered language is not an error:
 * react-syntax-highlighter checks `listLanguages()` first and renders the
 * code as plain text, which is also what the full build did for names it
 * did not know (e.g. "typescriptreact").
 *
 * Grammar aliases (`ts`, `js`, `html`, `xml`, `sh`, `yml`, `md`, ...) are
 * declared by the grammars themselves, so they keep working.
 */
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import clojure from "react-syntax-highlighter/dist/esm/languages/prism/clojure";
import cmake from "react-syntax-highlighter/dist/esm/languages/prism/cmake";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import dart from "react-syntax-highlighter/dist/esm/languages/prism/dart";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import elixir from "react-syntax-highlighter/dist/esm/languages/prism/elixir";
import erlang from "react-syntax-highlighter/dist/esm/languages/prism/erlang";
import git from "react-syntax-highlighter/dist/esm/languages/prism/git";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import haskell from "react-syntax-highlighter/dist/esm/languages/prism/haskell";
import hcl from "react-syntax-highlighter/dist/esm/languages/prism/hcl";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import json5 from "react-syntax-highlighter/dist/esm/languages/prism/json5";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import less from "react-syntax-highlighter/dist/esm/languages/prism/less";
import lua from "react-syntax-highlighter/dist/esm/languages/prism/lua";
import makefile from "react-syntax-highlighter/dist/esm/languages/prism/makefile";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import nginx from "react-syntax-highlighter/dist/esm/languages/prism/nginx";
import objectivec from "react-syntax-highlighter/dist/esm/languages/prism/objectivec";
import ocaml from "react-syntax-highlighter/dist/esm/languages/prism/ocaml";
import perl from "react-syntax-highlighter/dist/esm/languages/prism/perl";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import protobuf from "react-syntax-highlighter/dist/esm/languages/prism/protobuf";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import r from "react-syntax-highlighter/dist/esm/languages/prism/r";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sass from "react-syntax-highlighter/dist/esm/languages/prism/sass";
import scala from "react-syntax-highlighter/dist/esm/languages/prism/scala";
import shellSession from "react-syntax-highlighter/dist/esm/languages/prism/shell-session";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import vim from "react-syntax-highlighter/dist/esm/languages/prism/vim";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import zig from "react-syntax-highlighter/dist/esm/languages/prism/zig";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";

import scss from "react-syntax-highlighter/dist/esm/languages/prism/scss";

/** Grammar name → refractor grammar. Keys are Prism's canonical names. */
const PRISM_GRAMMARS = {
  bash,
  c,
  clojure,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  docker,
  elixir,
  erlang,
  git,
  go,
  graphql,
  haskell,
  hcl,
  ini,
  java,
  javascript,
  json,
  json5,
  jsx,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  markup,
  nginx,
  objectivec,
  ocaml,
  perl,
  php,
  powershell,
  protobuf,
  python,
  r,
  ruby,
  rust,
  sass,
  scala,
  scss,
  "shell-session": shellSession,
  sql,
  swift,
  toml,
  tsx,
  typescript,
  vim,
  yaml,
  zig,
} as const;

for (const [name, grammar] of Object.entries(PRISM_GRAMMARS)) {
  SyntaxHighlighter.registerLanguage(name, grammar);
}

/** Registered Prism grammar names (canonical names only, aliases excluded). */
export const PRISM_LIGHT_LANGUAGES: readonly string[] =
  Object.keys(PRISM_GRAMMARS);

/** Drop-in replacement for `Prism` from "react-syntax-highlighter". */
export { SyntaxHighlighter as PrismLight };

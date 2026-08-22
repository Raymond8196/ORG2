// highlight.js ships types only for its root entry and `lib/core`; the
// per-language subpaths (`highlight.js/lib/languages/<name>`) resolve through
// the package `exports` map but have no declaration files.
declare module "highlight.js/lib/languages/*" {
  import type { LanguageFn } from "highlight.js";

  const language: LanguageFn;
  export default language;
}

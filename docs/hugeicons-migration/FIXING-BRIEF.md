# Hugeicons migration — residue fixing brief

Read this before touching anything. It is the whole context you need.

## What already happened

A codemod rewrote 883 files from `lucide-react` to `@hugeicons/*`. It handled
imports and JSX call sites. It is **done and committed** — do not re-run it,
do not revert it.

## The one thing that is still broken

Lucide exported each icon as a **React component**. Hugeicons exports each icon
as **data** (`IconSvgElement`, an array of `[tag, attrs]` pairs) that gets fed
to a single shared `HugeiconsIcon` renderer.

So anywhere the old code treated an icon as a component, it is now wrong:

```tsx
// BROKEN — icon is data now, not a component
const Icon = ICON_BY_ID[id];
return <Icon size={14} className="..." />;

// CORRECT
const icon = ICON_BY_ID[id];
return <HugeiconsIcon icon={icon} size={14} className="..." />;
```

```tsx
// BROKEN
return React.createElement(icon, { size: 14, className });

// CORRECT
return <HugeiconsIcon icon={icon} size={14} className={className} />;
```

```ts
// BROKEN — a leftover local alias the codemod generated
type LucideIcon = IconSvgElement;
interface Foo { icon: LucideIcon }

// CORRECT — use the real type, delete the alias
import { type IconSvgElement } from "@hugeicons/react";
interface Foo { icon: IconSvgElement }
```

Every error in your shard is a variation of one of those three. The TS codes
you will see are `TS2604`, `TS2786`, `TS2769`, `TS2322` — all "this data is
being used where a component was expected".

## Rules

1. **Preserve rendered output exactly.** Same `size`, same `className`, same
   conditional logic. You are changing *how* the icon is rendered, never
   *whether* or *which*.
2. **Do NOT add `strokeWidth`.** (Superseded instruction — earlier revisions of
   this brief said to pin `strokeWidth={2}`. That decision was reversed: the app
   ships at hugeicons' native 1.5.) If the original code passed an explicit
   `strokeWidth`, keep that exact value. If it passed none, add none.
3. **Delete `type LucideIcon = IconSvgElement;` aliases** the codemod left
   behind and use `IconSvgElement` directly. Import it as
   `import { type IconSvgElement } from "@hugeicons/react";`
4. **Stay inside your shard.** If a fix requires editing a file outside your
   assigned paths, do not edit it — report it instead.
5. **Do not add dependencies, change config, or touch `package.json`.**
6. **Do not "improve" anything else.** No renames, no refactors, no lint
   cleanups beyond what your errors require.

## Verifying your work

Typecheck the whole project and count only errors in *your* shard:

```bash
cd /Users/laptop-h/Documents/GitHub/ORGII-hugeicons
./node_modules/.bin/tsc --noEmit --pretty false 2>&1 | grep -E "^src/(YOUR|PATHS|HERE)"
```

**`tsc` exits 0 even when there are errors in this repo — never trust the exit
code. Count the error lines.** You are done when that grep prints nothing.

Then format what you touched:

```bash
./node_modules/.bin/prettier --write "<your changed files>"
```

## Reference

- `docs/hugeicons-migration/icon-mapping.md` — the 425-row lucide→hugeicons map
- `scripts/hugeicons/icon-map.json` — same data, machine-readable
- `HugeiconsIcon` props: `icon` (required), `size`, `strokeWidth`,
  `absoluteStrokeWidth`, `color`, `className`, `ref`, plus all SVG props

## Report back

- files changed, and the error count in your shard before vs after
- anything you could not fix, and why
- anything outside your shard that needs a change
- any icon whose *visual* result you suspect is wrong (wrong glyph, not wrong
  types) — flag it, do not fix it

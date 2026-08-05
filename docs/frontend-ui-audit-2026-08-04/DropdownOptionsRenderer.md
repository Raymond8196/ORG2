# Frontend UI Audit — DropdownOptionsRenderer

## D1 — Raw HTML vs Design System

| Line / element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- |
| `DropdownOptionsRenderer.tsx` options `<div>` | keep with reason | This is the shared Dropdown listbox renderer itself. It owns overflow and scroll behavior and is not a substitute for the Dropdown trigger or item primitives. | — |

## D2 — Arbitrary Tailwind Value vs Token

| Line / element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- |
| `tokens.ts` 700ms hide delay | keep with reason | The value is centralized in the Dropdown panel token contract and consumed by both behavior and tests. | — |

## D3 — Hardcoded Sizes / Colors

| Line / element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- |
| `index.scss` 6px scrollbar / 3px radius / 160ms transition | keep with reason | Browser scrollbar pseudo-elements cannot be expressed through current Tailwind utilities; values remain isolated under the shared Dropdown helper class and use theme color variables. | — |

## D4 — Accessibility

| Line / element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- |
| `onScroll` visibility behavior | keep with reason | It changes only a visual scrollbar thumb class; option semantics, focus, keyboard navigation, and selection are unchanged. Reduced-motion CSS removes the fade transition. | — |

## D5 — Visual Patterns Observed

- One shared `dropdown-options-scrollbar` pattern is retained for every overflowing Dropdown option list.
- No duplicate component or new visual primitive is introduced.

## Summary

- 0 fixes required
- 4 kept with documented reason
- 0 abstraction candidates

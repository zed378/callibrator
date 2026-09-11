# UI-UX source assets

## `brand-sheet.svg`

The supplied brand artwork — a single CorelDRAW artboard carrying all four
variants side by side (symbol mark, dark-background variant, monochrome, app
icon) plus their captions and a `#D7EEF2` sheet background.

**It is the source, not a deliverable.** Nothing imports it: the four variants
were cut out of it into [`../../../frontend/public/brand/`](../../../frontend/public/brand/),
and the in-app mark is inlined by `frontend/src/components/brand/BrandIcon.tsx`.

It is kept here rather than in `frontend/public/` so it is not served, and
rather than deleted so the derived assets can be re-cut or corrected against
the original.

| Variant | Cut to |
|---|---|
| Symbol mark (navy + teal, transparent) | `brand/lockup-light.svg`, `brand/mark.svg` |
| Dark background variant | `brand/lockup-dark.svg` |
| Monochrome version | `brand/lockup-mono.svg` |
| App icon | `brand/app-icon.svg`, `public/favicon.ico`, `public/apple-touch-icon.png` |

`brand/mark-dark.svg` has no counterpart on the sheet: it is the symbol mark
with navy swapped for white, for dark surfaces.

Palette: navy `#001250`, teal `#00DAB4`, ink `#2A2A2A`.

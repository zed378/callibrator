# 09 — Spacing and Grid

---

## The Scale

A 4px base, with an 8px rhythm for anything structural.

```
0   1   2   3   4   6   8   12  16  20  24  32
0   4   8   12  16  24  32  48  64  80  96  128   (px)
```

Tailwind's default scale, unmodified. A custom scale buys nothing and costs everyone the ability to read a class name and know what it means.

Structural spacing — gaps between cards, section padding, page margins — uses the 8px steps. The 4px steps are for inside a component.

## Density Follows Task

The single spacing decision that matters (P7).

| Screen | Density | Row height | Why |
|---|---|---|---|
| Device register | dense | 40px | scanning for an exception |
| Stock list | dense | 40px | scanning |
| Audit trail | dense | 36px | scanning, high volume |
| Notification list | medium | 56px | reading |
| **Calibration entry** | **spacious** | — | precision; a wrong number here is a compliance defect |
| **Certificate signing** | **spacious** | — | consequence |
| Dashboard tiles | spacious | — | the figures must be readable at a glance |

A calibration form crammed to fit above the fold is how a wrong measurement gets typed. Giving it room is not indulgence.

## Page Layout

```
┌──────────┬────────────────────────────────────────────┐
│          │  header — 64px                             │
│ sidebar  ├────────────────────────────────────────────┤
│  256px   │                                            │
│  (64px   │  content                                   │
│ collapsed│  padding 24px  ·  max-width 1440px         │
│          │                                            │
└──────────┴────────────────────────────────────────────┘
```

Content is capped at 1440px and centred. Beyond that, a table row becomes a line the eye has to track across a metre of screen, and the relationship between the first and last column is lost.

Full-bleed is permitted only for the Kanban board, where horizontal space is the point.

## Breakpoints

Tailwind defaults.

| | Width | Dashboard behaviour |
|---|---|---|
| `sm` | 640 | sidebar becomes a drawer; tables become cards |
| `md` | 768 | two-column forms collapse to one |
| `lg` | 1024 | sidebar persistent |
| `xl` | 1280 | full layout |
| `2xl` | 1536 | content capped at 1440 |

## The Mobile Case Is Real

Budi records calibrations on a phone, standing, at the end of a shift ([`03-PERSONAS.md`](./03-PERSONAS.md)). Mobile is not a courtesy here.

| Rule | |
|---|---|
| Touch targets **44×44px minimum** | |
| Tables become cards below `sm` | a horizontally scrolling table is unusable one-handed |
| Primary action reachable by thumb | bottom of the viewport, not the top right |
| Numeric fields get numeric keyboards | |
| The save control is never below a scroll | on the forms that matter |

The auditor on `/verify/[certificateNumber]` is also on a phone, on a device nobody has tested, in unknown light.

## Forms

| Element | Spacing |
|---|---|
| Label to field | 4px |
| Field to helper or error | 4px |
| Field group to field group | 24px |
| Section to section | 32px, with a rule |
| Actions from the last field | 32px |

Two-column forms only above `md`, and only where the two fields are genuinely related — a from/to pair, a start/end date. Unrelated fields side by side make people skip one.

## Tables

| Element | Spacing |
|---|---|
| Cell padding | 12px horizontal, 8px vertical (dense) |
| Header | 12px vertical, with a bottom rule |
| Row separator | 1px, low contrast |

Alignment: text left, **numbers right, tabular**. Status badges left in their own column, never overlaid on another value.

Never truncate a serial number, certificate number or measurement — wrap, or give the column room ([`07-TYPOGRAPHY.md`](./07-TYPOGRAPHY.md)). A truncated serial is a shape that looks like a serial.

## Cards and Dashboard Tiles

| Element | |
|---|---|
| Card padding | 24px |
| Card gap | 16px |
| Tile grid | 4 across at `xl`, 2 at `md`, 1 below |

A dashboard tile has one number and one label, and the number is the largest thing in it. A tile carrying three figures is a table pretending to be a tile.

## Modals and Drawers

| | |
|---|---|
| Modal max-width | 560px — 720px for forms |
| Modal padding | 24px |
| Drawer width | 400px, full width below `sm` |
| Overlay | dimmed, click-outside closes unless the form is dirty |

A confirmation modal for a destructive action states what will be true afterwards, not "are you sure" (P4).

## Vertical Rhythm

Consecutive sections share the same top spacing so a page has a discernible beat.

**Space is the primary emphasis mechanism**, not weight. A screen where four things are bold has nothing emphasised; a screen where one section has twice the space around it has one thing emphasised.

## Empty and Error States

Both get generous space — 48px vertical padding, centred, with the action.

They are the same size as a populated state so the layout does not jump when data arrives. A list that collapses to a thin strip when empty and expands on load makes the page feel broken.

`EmptyState` and `ErrorState` are separate components (P3). Rendering an empty list when the request failed is a lie about a compliance figure.

## The Kanban Exception

The board is the one screen where horizontal space is the content. It is full-bleed, columns scroll horizontally, and the density rules above do not apply.

Cards on it are compact by necessity, and `kanban_columns.wipLimit` is displayed as a constraint rather than enforced by layout.

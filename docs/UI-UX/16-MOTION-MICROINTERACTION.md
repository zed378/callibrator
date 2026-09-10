# 16 — Motion and Microinteraction

**In the dashboard, motion is a state signal. On the public surfaces, motion is expression.** The two budgets are separate and neither borrows from the other (P9).

---

## The Dashboard Rule

Motion conveys that something **changed**. Nothing else.

| Permitted | Duration |
|---|---|
| A new notification arriving | 200ms |
| A row updating in place | 150ms |
| Batch job progress advancing | continuous, but linear and slow |
| A toast entering and leaving | 200ms in, 150ms out |
| A drawer or modal opening | 200ms |
| A skeleton shimmering | subtle, or omitted |

| Forbidden | Why |
|---|---|
| Page transitions | they delay work by their own duration |
| Scroll-driven reveals | content that appears late is content missed |
| Parallax | |
| Staggered list entrances | a list of 40 devices staggering in is 40 delays |
| Anything above 300ms | |
| Motion as the **only** signal | it is invisible to anyone not looking, and to reduced-motion users |

Budi is recording a calibration at the end of a shift. Every millisecond of animation is a millisecond he is waiting.

## Motion Is Always Redundant

Every animated signal has a non-motion equivalent that carries the same information.

| Signal | Motion | Non-motion equivalent |
|---|---|---|
| New notification | bell pulse | count badge changes |
| Row updated | brief highlight | the value itself changed |
| Job progressing | bar advances | `47 / 84` text |
| Save succeeded | toast slides in | the record reflects the change |

This is required by `prefers-reduced-motion`, and it is also just correct: a user scanning a dense table is not watching for a pulse.

## `prefers-reduced-motion`

Honoured throughout, as a **full alternative** rather than a degraded one.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

On the landing page this means the scroll-driven composition resolves to a static, complete layout — not a broken one with elements stuck mid-transition. That is the test: with motion off, does the page still say everything it was going to say?

## Timing and Easing

| Purpose | Duration | Easing |
|---|---|---|
| State change (hover, focus, toggle) | 100–150ms | `ease-out` |
| Enter (modal, drawer, toast) | 200ms | `ease-out` |
| Exit | 150ms | `ease-in` |
| Attention (a value updating) | 300ms | `ease-in-out` |

Exits are faster than entrances. A dismissed element that lingers reads as unresponsive; an arriving element that snaps reads as jarring.

Motion tokens live in `globals.css` alongside the design tokens, so a duration is a named value rather than a number typed into a component.

## Focus and Hover

| Interaction | Treatment |
|---|---|
| Focus | **instant**, never animated — a delayed focus ring is a lost focus ring |
| Hover | 100ms |
| Active | instant |
| Disabled | no transition |

Focus visibility is an accessibility requirement, not a style choice ([`17-ACCESSIBILITY.md`](./17-ACCESSIBILITY.md)). It must be immediate and it must never be removed.

## Loading

| State | Treatment |
|---|---|
| Under 200ms | **nothing** — a flash of skeleton is worse than a brief wait |
| 200ms–2s | skeleton, matching the final layout's dimensions |
| Over 2s | skeleton plus a progress indication |
| Over 30s | it should have been a batch job |

Skeletons match the real layout's height so nothing jumps when data arrives. A list that collapses to a strip and then expands makes the page feel broken.

## Realtime Arrivals

Socket.IO pushes notifications live.

| Rule | |
|---|---|
| The bell count updates immediately | |
| A subtle pulse, once, 200ms | |
| **The dashboard tiles do not move** | figures that shift while being read are hard to trust and hard to quote |
| Sound is optional, respects autoplay policy | the first sound after page load may be suppressed — that is not an error |

Live-updating a compliance figure someone is about to say out loud in a meeting is worse than a stale one with a timestamp.

## The Public Surfaces

A different register entirely — see [`19-IMMERSIVE-REVAMP-PLAN.md`](./19-IMMERSIVE-REVAMP-PLAN.md) for the full treatment, including the GSAP, Lenis and Framer Motion budget.

The constraints that still apply:

| Rule | |
|---|---|
| Motion never blocks first paint | |
| `prefers-reduced-motion` yields a complete static page | |
| No motion on the **verification page**, at all | an auditor wants the answer, not a reveal |
| Lighthouse performance stays at 90+ | |

The verification page is the boundary case: it lives on the public side and follows dashboard rules, because it is a working tool.

## Microinteractions Worth Having

Small, and each earns its place by removing a question.

| Interaction | Removes the question |
|---|---|
| Save button shows a spinner, then a check | "did that go through?" |
| Copy-to-clipboard on a serial or certificate number | "did I copy it?" |
| Inline validation on blur | "will this be rejected?" |
| Optimistic reorder on the Kanban board | "is it moving?" |
| A transfer state badge changing on transition | "which step am I on?" |

## Microinteractions Deliberately Absent

| Absent | Why |
|---|---|
| Celebratory animation on save | recording a calibration is not an achievement |
| Animated empty-state illustrations | P1 — state before decoration |
| Hover-reveal row actions | invisible on touch, and touch is a primary case |
| Animated number counting up | a compliance figure should appear, not perform |

The last one is worth stating plainly: a number that counts up from zero is unreadable for the duration of the animation, and the number is the reason the tile exists.

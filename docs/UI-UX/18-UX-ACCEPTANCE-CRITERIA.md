# 18 — UX Acceptance Criteria

Criteria are `UX-<n>` and are pass or fail. "Mostly" is a fail.

Product-level acceptance is in [`../PLAN/17-ACCEPTANCE-CRITERIA.md`](../PLAN/17-ACCEPTANCE-CRITERIA.md).

---

## Honesty — unwaivable

These are unwaivable because failing one means the interface lies about a compliance figure.

| ID | Criterion |
|---|---|
| **UX-1** | Every list distinguishes **loading**, **empty** and **failed**. A failed request never renders as an empty list. |
| **UX-2** | Every dashboard tile distinguishes **unavailable** from **zero**. |
| **UX-3** | Serial numbers, certificate numbers and measurements are **never truncated**. |
| **UX-4** | A measurement is always displayed with its uncertainty. |
| **UX-5** | Records with multiple actors show them separately — a certificate shows `calibratedBy`, `approvedBy` and `signedBy` as three people. |
| **UX-6** | Overdue is shown as a computed state alongside device status, not instead of it. |

UX-1 and UX-2 exist because the failure has happened: the QMS and SOP lists rendered empty for weeks after an envelope change, with no error anywhere.

## The Verification Page — unwaivable

| ID | Criterion |
|---|---|
| **UX-7** | Reachable and fully functional with **no session**. |
| **UX-8** | The verdict is the largest element, is a heading, and is a **word** — VALID, EXPIRED, REVOKED, NOT FOUND. |
| **UX-9** | "Not found" and "signature mismatch" render **identically**. |
| **UX-10** | Legible in greyscale and at 200% zoom on a 375px viewport. |
| **UX-11** | No animation. |
| **UX-12** | The page is **not indexed** by search engines. |

Every release must check this screen on a real phone. Nobody who works on the product uses it, which makes it the first forgotten and the last tested.

## Authorization in the UI

| ID | Criterion |
|---|---|
| UX-13 | Unauthorised surfaces are **absent** from the navigation, not disabled. |
| UX-14 | A route reached without permission shows `AccessDeniedModal` with an explanation and a way back — never a dead end. |
| UX-15 | An action that is legal but not permitted **for this user on this record** is shown disabled **with the reason**. |
| UX-16 | The navigation is rendered from the server-resolved menu tree, never from a client-side permission list. |

## State Machines

| ID | Criterion |
|---|---|
| UX-17 | Illegal transitions are absent from the interface. |
| UX-18 | A 409 surfaces as a state explanation — "this certificate is in `draft` and must be submitted first" — never a generic error. |
| UX-19 | Certificate **submit** is presented as a real step, not hidden behind approve. |
| UX-20 | Transfer state is shown as a state, never inferred from quantities. |
| UX-21 | Every quantity change in the UI routes through adjustment, transfer or opname — there is **no direct quantity edit**. |

UX-21 matters because the API permits what the UI must not: `PATCH /stocks/:id` can change `quantity` with no reason recorded.

## Destructive Actions

| ID | Criterion |
|---|---|
| UX-22 | Confirmations state what will be **true afterwards**, not "are you sure". |
| UX-23 | Revoking a certificate requires a reason. |
| UX-24 | Suspending the tenant **you belong to** is **refused**, not warned about. |
| UX-25 | An IP allowlist that excludes your current address is **refused**, naming the address. |
| UX-26 | Deleting a device states that calibration history and certificates are retained. |

UX-24 and UX-25 are refusals rather than warnings because neither has an in-product recovery.

## Accessibility — release gates

| ID | Criterion |
|---|---|
| UX-27 | WCAG 2.1 AA on every surface, in **both** themes. |
| UX-28 | Every interactive element reachable and operable by keyboard, including the Kanban board. |
| UX-29 | Visible focus indicator everywhere, at 3:1 contrast. |
| UX-30 | Contrast 4.5:1 for body text in both themes. |
| UX-31 | Every status badge carries **text**, never colour alone. |
| UX-32 | `prefers-reduced-motion` yields a **complete** static page, not a broken one. |
| UX-33 | Usable at 200% zoom without horizontal scrolling. |
| UX-34 | Every form control has an associated label; errors are inline **and** summarised. |
| UX-35 | Keyboard-only navigation of the calibration form and the verification page verified manually. |

## Responsive

| ID | Criterion |
|---|---|
| UX-36 | Tables render as cards below `sm`, keeping the serial in full and both status badges. |
| UX-37 | Touch targets 44×44px minimum, 8px apart. |
| UX-38 | No hover-only affordances. |
| UX-39 | On the calibration form and the opname counting screen, the save control is **never below a scroll**. |
| UX-40 | Numeric fields declare numeric input modes. |

## Performance

| ID | Criterion | Target |
|---|---|---|
| UX-41 | Dashboard first meaningful paint | under 2s on hospital wifi |
| UX-42 | Verification page interactive | as fast as achievable, verified on a real slow device |
| UX-43 | Lighthouse performance, public pages | 90+ |
| UX-44 | No animation over 300ms in the dashboard | |
| UX-45 | Skeletons match final layout dimensions | no jump on load |

## Consistency

| ID | Criterion |
|---|---|
| UX-46 | Every list uses the single `DataTable`, reading rows from `data` and pagination from the **top-level `meta`**. |
| UX-47 | Every domain state renders through `StatusBadge`. |
| UX-48 | Dates are unambiguous — `14 Mar 2026`, never `03/14/26`. |
| UX-49 | Relative time appears only **alongside** an absolute value, never instead of it. |
| UX-50 | Tenant branding never touches the status palette. |

## Release Checklist

- [ ] UX-1 through UX-12 pass — the unwaivable set
- [ ] Verification page checked **on a real phone**, in greyscale, at 200% zoom
- [ ] Calibration form completed keyboard-only
- [ ] Every screen checked in both themes
- [ ] `axe` clean in the component and browser suites
- [ ] Every list checked in all three states — loading, empty, **failed**
- [ ] Reduced-motion pass on every animated surface
- [ ] 375px viewport pass on the technician and warehouse paths

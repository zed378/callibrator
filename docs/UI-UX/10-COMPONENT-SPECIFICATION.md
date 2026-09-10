# 10 — Component Specification

Behaviour contracts for the components that carry compliance meaning. Visual tokens are in [`06-DESIGN-SYSTEM.md`](./06-DESIGN-SYSTEM.md).

---

## DataTable

The single list implementation. Every list in the product uses it.

**Contract**

| Input | From |
|---|---|
| `rows` | the response `data` array |
| `meta` | the **top-level** `meta` — never `data.meta` |
| `state` | `loading` · `ready` · `empty` · `error` |

**Three states, never conflated**

```
loading  → Skeleton, same height as a populated table
empty    → EmptyState  "No devices yet" + the create action
error    → ErrorState  "Could not load devices" + retry
```

Rendering an empty table when the request failed is a lie about a compliance figure (P3). This is the component that enforces it for the whole product, which is why there is only one.

**Rules**

- numbers right-aligned and tabular; text left
- serial numbers, certificate numbers and measurements **never truncated**
- status is its own column, as a `Badge` with text
- every row links to a stable URL
- sort and filter state lives in the URL, so a view is shareable

## StatusBadge

**Contract:** takes a domain and a state; resolves the semantic token and the label.

**Rules**

- **always carries text.** A coloured dot is not a status ([`08-COLOR-SYSTEM.md`](./08-COLOR-SYSTEM.md))
- domain-aware: `pending` means different things for a transfer and a certificate
- computed states are supported — **overdue is derived from `nextCalibrationDate`**, not read from a column

A device can be `active` **and** overdue at once. The row shows both badges. Collapsing them loses the distinction between "in service" and "in service but out of interval", which is the distinction an auditor asks about.

## AttributionRow

Renders who and when for a record (P5).

**Rule:** where a record has multiple actors, show them **separately**. Certificates show `calibratedBy`, `approvedBy` and `signedBy` as three people.

Collapsing them into "last modified by" destroys at the interface exactly what the schema went to trouble to preserve — separation of duties is the evidence.

## MeasurementValue

Renders a measurement with its uncertainty.

```
35.2 ± 0.3 °C
```

**Rules**

- mono, tabular figures
- **the uncertainty is never optional.** A value without one renders as incomplete, not as a bare number
- never truncated

"35.2 °C" alone is a number, not a measurement ([`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md)).

## TransitionButton

Every state-machine action — certificate submit/approve/sign/revoke, transfer advance, work-order status.

**Contract**

| Input | |
|---|---|
| `from`, `to` | the transition |
| `allowed` | is it legal from the current state |
| `permitted` | may this user perform it |
| `reason` | why not, when `permitted` is false |

**Rules**

- illegal transitions are **absent**
- permitted-but-not-by-you shows the control **disabled with the reason** — "you cannot approve a certificate you calibrated" is useful; a missing button is not (P2's exception)
- destructive transitions confirm, and the confirmation states what will be **true afterwards**, not "are you sure" (P4)
- a 409 from the server surfaces as "this certificate is in `draft` and must be submitted first", never as a generic error

## ConfirmDialog

**Rule:** the body states the consequence in the user's terms.

| Action | Body |
|---|---|
| Delete a device | "Calibration history and certificates are retained." |
| Revoke a certificate | "The public verification page will report REVOKED." — requires a reason |
| Suspend a tenant | "Every user in **Rumah Sakit X** will be unable to sign in." |
| Restore a backup | names the backup **and** the target |

**Two dialogs must refuse, not warn:**

- suspending the tenant **you belong to** — you cannot reverse it (BR-3)
- an IP allowlist that excludes **your current address** — there is no in-product recovery

Both are the same shape: an action that removes the ability to undo it. Under pressure is exactly when they get confirmed carelessly.

## BatchJobProgress

**Contract:** `status`, `progress`, `processedItems`, `totalItems`, `resultUrl`, `errorDetails`.

**Rules**

- shows `processedItems / totalItems`, not only a percentage — "47%" cannot tell you whether that is 47 rows or 47,000
- terminates visibly in `COMPLETED` or `FAILED`
- **a job in `PROCESSING` past a threshold is surfaced as stalled.** `PROCESSING` is not a resting state, and a permanent spinner is indistinguishable from work in progress

## AccessDeniedModal

Shown when a route is reached without permission — a stale menu, a permission revoked mid-session, a bookmark.

**Rules:** explain, and offer a way back. A dead end is worse than a refusal.

Never enumerate what permission was missing in a way that maps the feature surface for someone probing.

## NotificationBell and Toast

**Bell:** live count over Socket.IO, typed by `SYSTEM` / `CALIBRATION` / `INVENTORY` / `MAINTENANCE`, each item linking through its `actionUrl`.

A notification that says something happened without linking to it makes the user search for it, which is how notifications get ignored.

**Toast:** transient, and **never the only signal for anything important**. A toast is missed by anyone not looking at that corner, and by anyone using a screen reader that has moved on. Persist anything consequential.

Sound respects the browser autoplay policy — the first sound after page load may be suppressed, and that is not an error.

## VerificationVerdict

The public `/verify/[certificateNumber]` screen. The one component with a regulatory consequence for a design failure.

**Rules**

- the verdict is the **largest thing in the product** (`display` size)
- the **word** carries the message; colour reinforces it
- four outcomes: `VALID` · `EXPIRED` · `REVOKED` · `NOT FOUND`
- "not found" and "signature mismatch" render **identically** — otherwise it is a certificate-number oracle
- no animation, no heavy client dependencies, works on any phone
- below the verdict: device, calibration date, valid-until, issuing tenant — enough to match the paper in hand, nothing more

Nobody who works on the product uses this screen, which makes it the first to be forgotten in a redesign and the last to be tested.

## Form Field

**Rules**

- label above, always — never placeholder-as-label
- required marked on the field itself
- errors inline beside the field, plus a summary for screen readers
- server 400 field errors map back to their fields; the API returns field detail, so use it
- numeric fields get numeric input modes
- **no autosave anywhere in the compliance path** — a calibration record is saved deliberately

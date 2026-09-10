# 01 — Design Principles

Nine principles. Each is stated with the decision it settles, because a principle that settles nothing is a slogan.

---

## P1 — State before decoration

The first thing on any screen is what is true. How many devices are overdue. Whether this certificate is signed. What is waiting for you.

**Settles:** no hero banner on the dashboard, no welcome card, no empty-state illustration above real data.

## P2 — Absent, not disabled

An unauthorised surface does not appear. The sidebar is rendered from the server-resolved menu tree ([`../FRONTEND/05-RBAC-IN-UI.md`](../FRONTEND/05-RBAC-IN-UI.md)).

Greyed-out menus teach users that the software is arbitrary, and they leak the shape of features a tenant is not paying for.

**Settles:** no disabled navigation items, no "upgrade to unlock" in the primary nav.

**Exception:** a *disabled action inside a screen you can legitimately see* is fine, and should say why — "you cannot approve a certificate you calibrated" is useful.

## P3 — Never fake certainty

A value that could not be computed shows as unavailable, not as zero. A list that failed to load says so; it does not render empty.

**Settles:** every list distinguishes three states — loading, empty, failed. Rendering "0 devices" when the request 500ed is a lie about a compliance figure.

This principle exists because the failure has happened: the QMS and SOP lists rendered empty for weeks because the response envelope changed and nothing surfaced an error.

## P4 — The dangerous action is the slow one

Destructive and irreversible actions get friction proportional to their consequence.

| Action | Friction |
|---|---|
| Mark a notification read | none |
| Delete a device | confirm |
| Revoke a certificate | confirm, with a reason |
| Suspend a tenant | confirm, naming the tenant |
| Restore a backup | confirm, naming the backup and the target |
| Set an IP allowlist | **confirm against your own current address** |

The last two can lock the operator out of the system. Both need the confirmation to state what will be true afterwards, not merely "are you sure".

## P5 — Show who and when

Every record that carries attribution displays it. Calibrations show who performed them; certificates show all three actors separately; audit entries show the actor and the time.

**Settles:** no anonymous "modified" timestamps. The whole product exists to make actions attributable, and hiding attribution in a tooltip undoes that at the interface.

## P6 — One envelope, one shape

Every list is rows plus pagination in the same structure, because the API returns rows in `data` and pagination in a top-level `meta` ([`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md)).

**Settles:** one table component, one pagination control, one empty state, one error state. A screen that invents its own list shape will render empty the day the envelope changes and nobody will notice.

## P7 — Density follows task

Dense where the user is scanning for an exception. Spacious where the user is entering data they must get right.

**Settles:** the device register is compact; the calibration entry form is not. A calibration form crammed to fit above the fold is how a wrong measurement gets typed.

## P8 — Colour means status, branding means identity

Status colour is reserved for status. Tenant branding (`tenants.primaryColor`) applies to chrome and identity only.

**Settles:** a tenant cannot choose a brand colour that makes decorative elements read as warnings, because branding never touches the status palette. See [`08-COLOR-SYSTEM.md`](./08-COLOR-SYSTEM.md).

## P9 — Motion is a signal, not a texture

In the dashboard, motion conveys that something changed and nothing else. It is always redundant with a non-motion signal, because `prefers-reduced-motion` must be honoured and a moving element is unreadable to someone scanning.

**Settles:** no parallax, no scroll-driven reveals, no animated page transitions inside `/dashboard`. The public surfaces are a different register ([`19-IMMERSIVE-REVAMP-PLAN.md`](./19-IMMERSIVE-REVAMP-PLAN.md)).

---

## Applying Them: worked examples

### The dashboard

P1 puts the compliance figures first. P3 means a tile whose query failed says so rather than showing zero — a "0 overdue" that is actually a failure is the most dangerous single pixel in the product. P7 gives the headline figures room and keeps the supporting lists tight.

### The certificate screen

P5 shows `calibratedBy`, `approvedBy` and `signedBy` as three separate people, because that separation is the evidence. P4 makes revoke a confirmed action with a reason. P2 hides the approve control from someone who cannot approve — but P2's exception applies if they can see the screen and simply cannot act on this particular certificate, in which case say why.

### The stock transfer

P4 gives each state transition a confirmation, because quantity moves. P3 shows the transfer state explicitly rather than inferring it from quantities. P6 keeps the transfer history in the same list shape as everything else.

### The public verification page

P1 puts the verdict — valid, expired, revoked, not found — at the top, at size, before anything else. P3 means "we could not check" is a distinct outcome from "invalid". P9 means no animation: an auditor holding a phone wants the answer, not a reveal.

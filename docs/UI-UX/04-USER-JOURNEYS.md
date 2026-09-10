# 04 — User Journeys

Longer arcs than the screen-level flows in [`05-USER-FLOWS.md`](./05-USER-FLOWS.md). Each names the persona, the emotional state, and where the journey is most likely to fail.

---

## J1 — Rina's morning check

**Persona:** Engineering Manager · **Frequency:** daily · **Duration target:** under 60 seconds

```
opens laptop → /dashboard → reads four figures → either closes it, or drills into one
```

| Step | What she needs |
|---|---|
| Sign in | remembered session, or one MFA prompt |
| Dashboard loads | under 2 seconds on hospital wifi |
| Reads | overdue count, due-in-30 count, open work orders, open non-conformances |
| Decides | nothing to do today, or one thing to chase |

**Where it fails:** a tile showing `0` because the query errored. She will report that number in a meeting and be wrong in front of the hospital director.

**The fix is a design rule, not a bug fix:** every tile distinguishes *unavailable* from *zero* (P3).

**Second failure mode:** twelve API calls to build one dashboard. On a hospital network that is twelve chances to be slow. The dashboard is one endpoint (`GET /api/v1/dashboard/metrics`) for this reason.

## J2 — Budi's calibration round

**Persona:** Technician · **Frequency:** several times daily · **Emotional state:** end of shift, tired, standing

```
scheduler → picks a due device → performs the physical work → records the result → next
```

| Step | Friction to remove |
|---|---|
| Find the device | search by serial, case-insensitive, partial match |
| Open the record form | pre-filled with the device, the standard, and the interval |
| Enter results | large targets, sensible keyboard types, no fighting the form |
| Save | one action, clear confirmation, `nextCalibrationDate` visibly updated |

**Where it fails:** an exact-match serial search. Serial numbers are printed on labels that get scuffed, and typed from memory.

**Second failure:** a form that scrolls, so the save button is somewhere he has to hunt for. P7 says this form gets space — space above the fold, not more scrolling.

**What must not be optimised away:** the record is append-only (BR-7). There is no "edit last entry" shortcut, and the UI should say so before he needs it, not after.

## J3 — Sari's shift

**Persona:** Warehouse Staff · **Frequency:** continuous · **Emotional state:** interrupted constantly

```
receive → adjust stock upward with a reason
transfer → create → mark in transit → mark received
opname → schedule → count → complete
```

She holds **write** on `warehouse` — more than a supervisor. She is the one who moves things.

**Where it fails:** the transfer state machine being invisible. If she cannot see at a glance which transfers are in transit, stock exists in a van and in two spreadsheets.

**Design consequence:** transfer state is shown explicitly as a state, never inferred from quantities. `in_transit` exists precisely because stock in a van is neither here nor there, and a UI that hides that recreates the phantom inventory the model was built to prevent.

**The open gap:** `PATCH /stocks/:id` can change `quantity` with no reason recorded. The UI must not offer that path — every quantity change goes through adjustment, transfer or opname.

## J4 — Dewi issues a certificate

**Persona:** Calibrator Admin · **Frequency:** daily · **Stakes:** her lab's accreditation

```
calibration record exists
   → create certificate (draft)
   → submit  → pending_approval
   → approve → approved            (different person)
   → sign    → signed              (possibly a third person)
   → PDF renders with QR
   → hand it to the customer
```

| Step | What the UI owes her |
|---|---|
| Draft | the calibration record's data carried forward, not retyped |
| Submit | clear that this is what makes approval possible |
| Approve | visibly a different person from the calibrator |
| Sign | the signature meaning stated, because it is recorded (`e_signature_records.meaning`) |
| PDF | renders, or fails **loudly** |

**Where it failed, historically:** there was no submit step at all, and approving a draft threw a 500. Approval was unreachable. That is now a 409 with an explicit submit transition (ADR-035) — and the UI must present submit as a real step rather than hiding it behind approve.

**Where it still fails:** PDF rendering needs a system Chromium (`PUPPETEER_EXECUTABLE_PATH`). Outside Docker it fails at **first use**, not at startup — a late failure in a compliance-critical path. The UI must surface that as a clear error, not a silent missing download.

## J5 — Onboarding a new tenant

**Persona:** Andi (operator), then the tenant's first admin · **Duration:** minutes to weeks

```
Andi creates the tenant           ← minutes
Andi creates the first admin      ← minutes
   ─── tenant is fully usable here ───
tenant admin adds branding        ← optional, later
tenant admin configures storage   ← optional, later
tenant admin adds a custom domain ← optional, later
tenant admin wires OIDC or SCIM   ← optional, later
```

**The design rule:** everything after step 2 is optional and must be reachable later without penalty. An onboarding wizard that demands all seven steps before letting anyone in is how a trial dies on day one.

**Where it fails:** `subdomain` is derived from `code` and never asked for. If the UI displays it as though the user chose it, they will be confused by a value they did not type.

## J6 — The auditor verifies a certificate

**Persona:** the seventh reader — no account, will never have one · **Frequency:** once

```
holds a printed certificate → scans the QR → reads a verdict
```

That is the whole journey. It is over in five seconds and it is the moment the entire product either works or does not.

| Requirement | Why |
|---|---|
| No login | a certificate only they can check is not evidence |
| Verdict first, at size | valid / expired / revoked / not found |
| Works on any phone | they bring their own device |
| No animation | they want the answer, not a reveal |
| Identical response for unknown and tampered | otherwise it is a certificate-number oracle |

**Where it fails in a redesign:** nobody who works on the product uses this screen, so it is the first to be forgotten and the last to be tested.

## J7 — Something goes wrong

**Persona:** any · **Emotional state:** already annoyed

```
raise a ticket → wait → read the response → confirm or push back
```

Pak Hendra, a weekly user, must be able to do this without knowing the system's vocabulary. He does not know what a "non-conformance" is and should not have to.

**Design consequence:** the raise form asks what happened in plain language and lets category be optional. A required taxonomy field on a support form is a way of making people give up.

**On the other side:** `ticket_comments.isInternal` marks responder-only notes. A list query that forgets the flag shows internal notes to the person who raised the ticket, which is worse than any UI defect on this journey.

---

## The Pattern Across All Seven

| Journey | Fails because of |
|---|---|
| J1 | a number that lies |
| J2 | friction in a form used while tired |
| J3 | hidden state |
| J4 | a missing step and a late failure |
| J5 | mandatory optional steps |
| J6 | being forgotten |
| J7 | assumed vocabulary |

None of them fails because the software looks insufficiently impressive.

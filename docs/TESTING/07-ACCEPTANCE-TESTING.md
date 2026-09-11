# 07 — Acceptance Testing

The final gate. Criteria: [`../PLAN/17-ACCEPTANCE-CRITERIA.md`](../PLAN/17-ACCEPTANCE-CRITERIA.md) (product) and [`../UI-UX/18-UX-ACCEPTANCE-CRITERIA.md`](../UI-UX/18-UX-ACCEPTANCE-CRITERIA.md) (interface).

---

## What Acceptance Is

Not "the tests pass". Acceptance answers: **would this survive an accreditation surveyor, and would the people who use it every day be able to do their jobs?**

Every criterion is pass or fail. "Mostly" is a fail.

## Unwaivable

**A multi-tenancy finding is not waivable by anyone.** Everything else is negotiable with a recorded decision naming **who agreed**.

| ID | Criterion |
|---|---|
| AC-1 | No cross-tenant read is possible on any endpoint |
| AC-2 | An authenticated principal with no tenant sees **zero** rows |
| AC-3 | Every mutation writes an audit row |
| AC-4 | Non-existent, soft-deleted and not-yours are **indistinguishable** — all 404 |
| AC-5 | No secret in the repository, in a log, or in a response |
| AC-6 | Rate limiting active on auth, OTP and global paths |
| AC-7 | An upload is rejected when the scanner errors |
| AC-8 | A suspended tenant cannot make any authenticated request |
| UX-1 | Every list distinguishes loading, empty and **failed** |
| UX-2 | Every dashboard tile distinguishes **unavailable** from **zero** |

UX-1 and UX-2 sit alongside the security set because failing them means the interface lies about a compliance figure — and someone repeats that figure in a meeting.

## Persona Walkthroughs

Automated criteria do not catch friction. Each of these is a person doing their actual job, timed.

### Rina — the morning check (J1)

```
sign in → read the dashboard → decide → done
```

- [ ] under **60 seconds** end to end
- [ ] the overdue count is the first thing readable
- [ ] a tile whose query failed shows **unavailable**, not `0`

### Budi — a calibration round (J2)

```
scheduler → pick a due device → record the result
```

- [ ] serial search is **case-insensitive and partial**
- [ ] the form is prefilled from the device
- [ ] **the save control is never below a scroll**, at 375px
- [ ] the new `nextCalibrationDate` is shown on save
- [ ] the append-only rule is stated **before** it is needed

### Sari — a warehouse shift (J3)

- [ ] in-flight transfers are visible at a glance
- [ ] transfer state is shown **as a state**, never inferred from quantities
- [ ] every quantity change captures a reason
- [ ] **no direct quantity edit is offered**
- [ ] opname counting is fully one-handed

### Dewi — issuing a certificate (J4)

- [ ] **submit** is presented as a real step
- [ ] approve is visibly a different person from the calibrator
- [ ] the signature meaning is stated at the moment of signing
- [ ] an invalid transition explains the state, not "something went wrong"
- [ ] PDF rendering fails **loudly** when Chromium is absent

### Pak Hendra — raising a ticket (J7)

- [ ] completable **without knowing the system's vocabulary**
- [ ] category is optional

### The auditor — verification (J6)

```
scan a QR → read a verdict
```

- [ ] **no login**
- [ ] the verdict is the largest element, and is a **word**
- [ ] legible in **greyscale** and at 200% zoom
- [ ] works on a **real, old phone**
- [ ] unknown and tampered look **identical**

This journey is five seconds long and it is the moment the product either works or does not.

## Compliance Walkthrough

Answer each question from the running system, as an auditor would ask it.

| Question | Answerable from |
|---|---|
| Which devices were out of calibration on date D? | the compliance report |
| Who performed calibration C, and were they competent? | `performedBy` → user → `sop_training_acknowledgments` |
| **Prove certificate X is genuine** | the public verification URL — **no login** |
| What changed on record R, when, by whom? | `audit_logs` filtered by `resourceId` |
| Show the CAPA for non-conformance N | `non_conformances` → `capas` |
| Show your supplier qualification for vendor V | `vendors`, `supplier_scorecards` |
| Show your retention and deletion policy | `data_retention_policies`, `dsar_requests` |

Every one is a query against an operational table, not a report assembled by hand. That is the design goal of the whole system.

## Release Gate

- [ ] AC-1 to AC-8 pass, **with the test named** in the release record
- [ ] AC-9 to AC-14 (compliance) pass
- [ ] UX-1 to UX-12 pass
- [ ] `pnpm test` green at the configured coverage thresholds
- [ ] `pnpm lint` and `pnpm build` clean
- [ ] **the live E2E suite green in one uninterrupted run**
- [ ] the browser suite green
- [ ] migrations apply to a clean database **and** to a copy of production data
- [ ] **migration results verified by inspecting columns**, not by trusting the log
- [ ] the verification page checked on a **real phone**, in greyscale, at 200% zoom
- [ ] the calibration form completed **keyboard-only**
- [ ] rollback **rehearsed**, not assumed
- [ ] a `MEMORY/` record written, including anything that failed or was waived and **who agreed**

## Two Items Currently Failing

Stated plainly, because a release checklist that quietly excludes its failures is not a checklist.

| Item | Status |
|---|---|
| Backend coverage gate (100%) | **passing** (2026-09-11) |
| Live E2E in one uninterrupted run | **never achieved** — every fix verified individually |

Both are the first items under "now" in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md).

Also outstanding: Swagger and the enforced validators disagree for the GDPR endpoints (AC-29).

## Sign-Off

An assertion that a test passed is not evidence. **Name the test.**

The record in [`../../MEMORY/records/`](../../MEMORY/records/) states:

- what was verified, and **how**,
- what failed, and what was done about it,
- **what was waived, by whom, and why**,
- what was **not** determined.

Per the honesty rules in [`../../MEMORY/README.md`](../../MEMORY/README.md): record what happened, not what was supposed to happen. A record that says "IDOR tested, all good" and names no test is worse than one that says nothing, because it stops anyone looking again.

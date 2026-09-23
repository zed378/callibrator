# Wave 0 Parallel Remediation — 2026-09-23

**Kind:** change record
**Tasks:** [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) — A-04, A-05, A-06, A-12, A-15, A-17, A-25, A-26, A-28, A-30, A-31, A-33, A-35, A-36, A-44, A-45, A-47, A-50
**Decision:** [ADR-040](../DECISIONS.md) — electronic signatures
**Preceded by:** [`2026-09-23-wave0-authorisation-fixes.md`](./2026-09-23-wave0-authorisation-fixes.md) (A-01, A-02, A-03, A-27)
**New findings opened:** A-33, A-34, A-37 … A-56 (twenty of them)

---

## How This Was Done

Nine agents working in parallel on disjoint file sets, each given one finding,
the repository's own rules, and a bar: prove the behaviour, name the test, and
say what you did **not** cover. The orchestrator held the audit file, the
records and the commits so there was a single writer for each.

That is worth recording because of what it produced. The findings below were
not on the board when the day started: **twenty of them were found while
fixing or documenting something else.** The pattern repeats — you cannot see
a defect of this kind by looking for it, only by trying to use the thing.

## Fixed

| Finding | What it was |
|---|---|
| **A-04** | `/search` returned devices, stock and certificates to roles that cannot list them. Each type is now filtered by **running the same gate its own list route runs**, so search can never surface a row that resource would refuse |
| **A-05** | Socket.IO: `origin: "*"`, the token in the query string, and no status or suspension check at connect. All three closed — and it turned out `kanban:join` ran with **no tenant context at all**, which the scope resolver reads as "skip the tenant predicate". Two accidents contained it (the project lookup carries an explicit tenant term, and the second query's model has no `tenantId` to scope), so no leak is demonstrable; the argument for fixing it is the mechanism — an entire transport failing open, undetectably — not a breach |
| **A-06 / A-15** | `/health` published Node version, pid and memory to anyone and checked only the database. Now: a verdict-only public endpoint, a super-admin-only per-dependency breakdown, and Redis and RabbitMQ actually probed |
| **A-17** | a public `0.0.0.0:19883` port with nothing behind it, removed |
| **A-25** | Stripe `upsertInvoice` only ever inserted. An invoice that failed and was later paid stayed `Open` forever |
| **A-26** | no consumer deduplicated. Redelivered emails were sent twice; batch jobs ran twice |
| **A-28** | calibration evidence, signing keys, controlled SOPs and the risk register were mutable by **any** role. Gated, with separation of duties on SOP publication and a soft delete plus audit row for attachments |
| **A-30** | the rate limiter's Redis client was constructed in a function that was never called, so every lockout lived in process memory and reset on each deploy |
| **A-31** | `JWT_REFRESH_SECRET` signed **nothing** — refresh tokens were signed from the access-key registry |
| **A-35** | every per-user permission override silently did nothing, including a `none` revocation |
| **A-36** | `connection.isOpen` does not exist in amqplib: every call opened a new AMQP connection and nothing closed it |
| **A-44** | the access log was never pruned — `history: "30d"` names a *file*, not a retention period |
| **A-45** | a decommissioned IoT device kept ingesting, and one bad MQTT message shut the server down |
| **A-47** | **no electronic signature could ever verify.** `Date.now()` was inside the hashed payload, and the tenant RSA key pairs signed nothing. Now a real RSA-SHA256 signature over a deterministic payload — [ADR-040](../DECISIONS.md) |
| **A-33** | SCIM PATCH ignored `path`, the form every IdP sends, so a deprovision returned 200 and left the account active |
| **A-12** | dead session-security middleware deleted, and the eleven documents and four ADRs that described its controls as real corrected |
| **A-50** | webhook deliveries followed redirects, so a `302` to `169.254.169.254` walked straight past the SSRF check |

## The Shape That Keeps Recurring

Three separate defects this week were the same mistake:

| Guard | Driver | Effect |
|---|---|---|
| `client.connected` | ioredis has no such property | every Redis helper was a no-op (A-24, fixed 2026-09-21) |
| `connection.isOpen` | amqplib has no such property | every broker call opened a new connection (A-36) |
| `redisReady` | set only inside a function nothing called | the rate limiter never used Redis (A-30) |

Each one had passing tests. Two of them had **mocks that invented the missing
property**, which is the mechanism: the mock proved the client, not the
contract, and the suite reported health the code did not have. The fixes now
mock only what the real driver exposes, and the A-30 work went further — its
live suite was run against a dead Redis port to confirm the tests can fail.

## Found While Fixing, Not Yet Fixed

A-47 was found this way too and is in the table above — it was fixed the same day
because of what it was. These are the ones still open:

Recorded as cards so they do not evaporate:

| | |
|---|---|
| **A-41** | audit rows are written on `res.on("finish")` — after the response, outside the transaction. The rule `CLAUDE.md` calls non-negotiable |
| **A-42** | a failed audit write is announced only to `console.error`, and production writes no stdout anywhere |
| **A-37** | SCIM user creation is a cross-tenant existence oracle: global unique email, tenant-scoped duplicate check |
| **A-38 / A-39** | SCIM Groups are global roles — one tenant's delete removes a role from every tenant — and a SCIM-created group grants nothing, silently |
| **A-43** | `auditAction` logs full request and response bodies unredacted; no redactor exists. No caller today, which is the only reason it is not a live leak |
| **A-46** | IoT anomaly detection cannot fire: `readingTolerance` is as unprovisionable as the device token |
| **A-34** | the backend lint gate had never run — a version mismatch crashed ESLint before it linted a file. It runs now; 1,319 findings behind it |
| **A-48** | **revocation does not revoke.** Nothing in the request path reads `sessions`, and the deployed `JWT_ACCESS_EXPIRED` is `1d` where the documentation says `15m` — checked on the running VM |
| **A-51** | webhook routes mount **no validator at all**: the signing secret is caller-supplied, stored in plaintext, and cannot be rotated |
| **A-55** | `createTwoTenants()` — the fixture `CLAUDE.md` says makes the mandatory 404 test one line — **does not exist**, in this file or any other |
| **A-40** | storage driver cache is per-process; a null-checksum migration reports `migrated` unverified |

## Corrections To Things Already Written Down

- **A-27's original write-up was wrong** about SCIM being `auth`-only (see the
  preceding record). Corrected in place.
- **A-29** said nothing sets `iotEnabled`. The demo seeder does. The
  conclusion stands; the premise was too broad.
- `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md` claimed `config/socket.js` was
  the only stdout output in production. There are **25** `console.*` sites,
  and the one that matters announces a failed audit write.
- `docs/DEVOPS/06-LOGGING.md` described a redactor as as-built. There is none.
  It also recorded 30-day access-log retention that did not exist.
- `docs/API/13-INTEGRATION-API.md` claimed SCIM responses use their own
  envelope (they are wrapped in the platform one), that `DELETE /Users`
  deactivates rather than erases (it calls `destroy()`), and that credentials
  are encrypted with `ENCRYPT_KEY` (it is `KMS_MASTER_KEY`).

## Evidence

`npm run test:coverage` — **306 suites, 6,000+ tests, 100 %** statements,
branches, functions and lines, with the two mid-flight modules excluded from
that snapshot and re-verified afterwards. Per-finding test names are in the
cards; the ones worth repeating here:

- "answers 404 for another tenant" — one per `tenant-hierarchy` read route
- "rejects a valid token whose tenant is suspended" — four spellings, asserting `socket.user` is never set
- "is NOT ready when Redis is down — the defect A-15 describes"
- "locks the account out on the fifth failure even when the first four were another replica's" — against a **real** Redis, and confirmed to fail against a dead one
- "sends ONE email when the same message is delivered twice, and ACKs the redelivery"
- "refuses publication by the SOP's own author with a 409 that explains the state"
- "reuses one connection across calls instead of opening a new one each time"

## What This Batch Does Not Cover

- **Almost nothing here was verified against a running server.** Every fix
  above is a unit or router-level test. Three things were checked live, on the
  VM, and they are the ones stated as fact: the two JWT secrets differ (so the
  A-31 startup check will not crash-loop the deployment), `JWT_ACCESS_EXPIRED`
  is `1d` there, and `signature_records` is **empty** — no archive was harmed
  by ADR-040. The live two-tenant and two-account reproductions, and
  `make test-e2e`, are still open.
- The **VM has not been redeployed** with these changes. Its `.env` was checked
  first, because two of them refuse to start on a bad configuration — equal JWT
  secrets and an unsupported `JWT_ALGORITHM` (A-31). Both are fine there.
- **Migration 0019 has not been run.** It adds the four signature columns and
  is written to fail loudly rather than no-op, but per the house rule the log
  is not evidence: confirm the columns in `psql` after `make migrate`.
- **Signing now returns 409 for a tenant with no key pair.** Nobody is blocked
  today (there are none, and nothing signs), but generating a key pair is now a
  prerequisite that did not exist before.
- `make verify` still cannot pass: the lint gate now runs and reports 1,319
  errors (A-34). They are formatting, not logic, and fixing them rewrites
  nearly every file, so it is its own commit.
- Several fixes change behaviour for callers in the field: API keys on
  attachment, e-signature and risk reads now authorize by scope; a plain
  `USER` gets 403 from `/search` rather than an empty list.

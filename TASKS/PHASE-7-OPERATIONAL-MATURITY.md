# Phase 7 — Operational Maturity

Making failures visible and recovery rehearsed.

Almost everything here is currently **absent rather than incomplete**. Saying so is more useful than describing a monitoring setup that does not exist.

---

### P7-01 — CI pipeline

| | |
|---|---|
| **Status** | 🟡 **PARTIAL (2026-09-25)** — workflow written and its local half verified; never run on GitHub. See `PROGRESS.md` and ADR-066 |
| **Depends on** | **P6-01** · **P9-02a** (lint) · **P9-01a** (typecheck) · **P6-14** (coverage scope) — do not build a pipeline around a failing gate |
| **Spec refs** | `docs/DEVOPS/01-CI-CD.md` · [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-19, A-21, A-34 |

> **What changed (2026-09-23).** This card's dependency — *"do not build a pipeline around a
> failing gate"* — now bites on two of the four stages it wanted to run **first**.
>
> | Stage | State 2026-09-23 |
> |---|---|
> | **lint** | A-34: the backend lint gate had **never run**; a version mismatch crashed ESLint and the crash looked like success. It runs again now and reports **1,297 errors and 340 warnings**. `make verify` therefore **cannot pass today** — it is `lint typecheck test build`, and `lint` exits non-zero → P9-02a |
> | **typecheck** | `make typecheck` → `pnpm typecheck` → `turbo run typecheck`, and **`backend/package.json` has no `typecheck` script**. Turbo skips a package that does not declare the task and exits 0. The backend has never been type-checked and will not start being so merely because a `tsconfig.json` appears → P9-01a |
> | **format** | two conflicting Prettier configs still govern `backend/` (`backend/.prettierrc`: double quotes, width 80; root `.prettierrc.js`: single quotes, width 100), and a legacy `backend/.eslintrc.js` sits beside `eslint.config.js` → P9-02 |
> | **secret scan / hook** | unchanged and still absent (A-19) |
> | **reproducible install** | **A-21 is still open**: `.gitignore` excludes `package-lock.json`, `pnpm-lock.yaml` **and** `bun.lock`. All three exist in the working tree and none is tracked. A pipeline built on this resolves dependencies fresh on every run, so a green pipeline is not a reproducible one |
>
> The card is not wrong. It is **blocked in a way it did not know about**, and building it before
> P9-02a and P9-01a land produces a pipeline whose first two stages are red on day one — which is
> how `continue-on-error` gets added.

**Why:** there is no automatic gate at all. **⚠ Corrected 2026-09-21 — there is no `pre-push` hook.** The repository has no `.husky/`, no `lefthook`, no `simple-git-hooks`, no `core.hooksPath`, and `.git/hooks/` holds only git's samples. The IDOR enforcement script this card referred to does not exist either: `backend/scripts/` contains only documentation generators. The only gate runner is `make verify`, which a developer must remember to type — and which could not run on the Windows workstation where this repository is developed, because `make` is not installed there.

The risk of deferring CI was recorded and is real: skipping it would have silently returned the zero-tolerance IDOR rule to being a sentence in a document — **its enforcement script had no caller other than a pipeline that did not exist.**

**Definition of Done**
- [ ] a lockfile is committed and the install uses the frozen-lockfile flag (A-21) — without it every stage below runs against a different dependency tree
- [ ] cheapest signal first: lint, format, typecheck → unit + coverage → secret scan → IDOR enforcement → **route-gate check (P6-04)** → **`ts-ratchet` (P9-04)** → images → migrations **with column verification (P6-05)** → E2E → browser
- [ ] **each stage is proved in the failing direction before the pipeline is trusted** — break the thing, watch that stage go red. A-34 and the turbo `typecheck` skip are both gates that reported green having run nothing; a pipeline inherits that failure mode unless each stage is seen to fail once
- [ ] the E2E stage gets rate-limit headroom
- [ ] images pushed only from a green run
- [ ] the same **image** promoted across environments — except the frontend, where `NEXT_PUBLIC_*` forces a rebuild per environment by design

**Abuse cases**
- A stage is marked `continue-on-error` to unblock a release
- The secret scan is allowlisted into uselessness
- A stage is added that cannot fail — the version of this that has already happened twice here

---

### P7-02 — Alerting on scheduled-job outcomes

| | |
|---|---|
| **Status** | 🟡 **PARTIAL (2026-09-25)** — in the application; infra-backup alert and channel routing open. ADR-066 |
| **Spec refs** | `docs/DEVOPS/07-ALERTING.md` |

**Why:** **a scheduled compliance job failing silently is worse than one that never ran, because everyone believes it did.**

This has already happened: the data-retention purge failed **every night** with `column "tenantId" does not exist` until somebody looked.

If only one thing in this phase gets built, it is this one.

**Definition of Done**
- [ ] alerts on: a scheduler did not run in its window; a scheduler ran and **failed**; a tenant backup failed; an infrastructure backup failed; the calibration sweep did not complete
- [ ] each alert says **what it means and what to do** — "Retention purge failed: data past its window was NOT purged" beats "Scheduler failed"
- [ ] a batch job resting in `PROCESSING` past a threshold alerts
- [ ] routed to a channel someone reads

**Abuse cases**
- The alert fires nightly, is ignored, and trains everyone to ignore alerts

---

### P7-03 — Structured log shipping

| | |
|---|---|
| **Status** | 🟡 **PARTIAL (2026-09-25)** — JSON + requestId done; shipping validated, never run; A-42 sweep open. ADR-066 |
| **Spec refs** | `docs/DEVOPS/06-LOGGING.md` · `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md` · [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-14, A-42, A-44 |

> **What changed (2026-09-23):** this card said logs "live in container stdout and a volume". A-42
> found that **production writes no stdout at all** — the winston Console transport is
> development-only — and that there are **25 `console.*` call sites in runtime backend code**
> whose output therefore goes to a stream nothing collects. `docs/ENGINEERING/12` claimed
> `config/socket.js` was "the only application output that reaches stdout in production"; that was
> corrected on 2026-09-23.
>
> The consequence is not cosmetic. **`audit.service.js#logAction` catches a failed insert, calls
> `console.error("Failed to write audit log (CRITICAL):", error)` and returns `null`.** A
> compliance record that fails to write therefore fails silently and durably — and P6-11 (A-41)
> cannot be signed off while that is true. A-44 (the access log was never pruned — `history` was
> read as a filename, not a retention period) is **`DONE`**; the rotation checkbox below should be
> verified against the fix rather than assumed.

**Why:** logs live in container stdout and a volume. Correlating a client symptom with a server line means finding the host first.

**Definition of Done**
- [ ] structured JSON output
- [ ] `X-Request-Id` on every line
- [ ] shipped to an aggregator
- [ ] **A-42 closed**: the failed-audit-write path goes through winston at `error` level so it lands in the file sinks and the aggregator, and the other 24 `console.*` sites are swept. This is the checkbox **P6-11 depends on** — an audit failure nobody can see is the same as no audit
- [ ] A-14 closed: per-request lines are not dropped, and the file sinks are bounded
- [ ] **redaction verified after shipping** — an aggregator with its own parsing can re-expose a field the application redacted, and a leak into a third-party store is a leak
- [ ] rotation confirmed **against the A-44 fix**, not against the setting it replaced; a full disk stops writes, including `audit_logs`

**Abuse cases**
- Debug logging is left on in production, which is where redaction discipline slips
- The `console.*` sweep is done with `--fix` on the lint rule, which silences the line rather than routing it

---

### P7-04 — A full restore drill

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/ARCHITECTURE/09-DISASTER-RECOVERY.md` · `docs/DEVOPS/04-DATABASE-BACKUP.md` |
| **Spec required** | **yes** |

**Why:** **no restore drill has ever been performed.** The 4-hour RTO is a guess, and the first rehearsal is where the surprises happen.

More seriously: **the lost-secrets failure is possible today.** A restore that recovers the database without `CERT_SIGNING_SECRET` and `ENCRYPT_KEY` produces a system that starts cleanly and is permanently broken — every certificate fails public verification, every wrapped credential is undecryptable. Nothing errors at boot.

**Definition of Done**
- [ ] a restore into a clean host, timed
- [ ] the checklist asserted, not assumed:
  - [ ] `/health` 200 with `database: "connected"`
  - [ ] a user can log in
  - [ ] a tenant-scoped list returns that tenant's rows **and no others**
  - [ ] **a certificate issued before the incident still verifies at its public URL**
  - [ ] **an attachment uploaded before the incident still downloads**
  - [ ] migrations report nothing pending
  - [ ] the audit trail is continuous across the restore point
- [ ] the measured RTO recorded, replacing the guess
- [ ] a record naming **what failed** — the drill is worth most if something does

The two bold checks are what catch a lost-secrets restore. Without them a broken recovery looks successful for weeks.

**Abuse cases**
- The drill restores and declares success without the certificate check

---

### P7-05 — Formalise the secret backup procedure

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Depends on** | P6-10 |
| **Spec refs** | `docs/SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md` |

**Why:** a backup strategy that captures the data and loses the keys has captured **ciphertext**.

**Definition of Done**
- [ ] `CERT_SIGNING_SECRET`, `ENCRYPT_KEY` and `ATTACHMENT_URL_SECRET` backed up **separately from the database and the host**
- [ ] access controlled and audited
- [ ] restore of the secrets is **part of the drill** (P7-04), not a footnote
- [ ] documented in the recovery runbook

---

### P7-06 — Validate the Helm charts against a real cluster

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Depends on** | a reachable cluster |
| **Spec refs** | `docs/DEVOPS/09-KUBERNETES.md` |

**Why:** the manifests **render**. They are **not known to be accepted by a cluster**. `helm lint` and `helm template` pass and both render-guards fire; `kubectl apply --dry-run=server` has not been run.

Turning "renders" into "works" is the whole task.

**Definition of Done**
- [ ] `kubectl apply --dry-run=server` clean
- [ ] a real install into a scratch namespace
- [ ] probes behave: liveness on `/`, readiness on `/health`, and a 503 keeps the pod **out of rotation without restarting it**
- [ ] the ingress passes WebSocket upgrades — verified by a **live notification**, not by reading the annotation
- [ ] `/oidc/*` reachable at the root
- [ ] both guards confirmed to fire against the cluster path too
- [ ] the record says what did not work — it will not all work first time

---

### P7-07 — Pin the two `:latest` base images

| | |
|---|---|
| **Status** | ✅ **DONE (2026-09-25)** — ADR-066 |
| **Spec refs** | `docs/DEVOPS/02-CONTAINERIZATION.md` |

**Why:** `clamav/clamav:latest` and `dpage/pgadmin4:latest` are unpinned (T42). A base image that changes underneath a deployment is a supply-chain risk and an unreproducible build.

**Definition of Done**
- [ ] both pinned to explicit versions
- [ ] a documented process for moving them
- [ ] every other base tag audited

---

### P7-08 — Split swagger onto its own CSP

| | |
|---|---|
| **Status** | 🟡 **PARTIAL (2026-09-25)** — API side done (ADR-066). Content origin done (ADR-071): a per-request nonce CSP from `frontend/src/proxy.ts`. The certificate frame was checked and external logos were decided (ADR-071 amendment 1). What remains is a suite-level browser test and the record |
| **Spec refs** | `docs/SECURITY/08-API-SECURITY.md` |

**Why:** the API CSP allows `'unsafe-inline'` for scripts because bundled swagger-ui injects inline assets.

**That reasoning does not transfer** to the Next.js origin serving user-authored `posts.contentHtml` — the stored-XSS surface of this system.

**Definition of Done**
- [x] swagger served with its own relaxed policy, or with a nonce (ADR-066)
- [x] the API default policy tightened to drop `'unsafe-inline'` for scripts (ADR-066)
- [x] the content-rendering origin verified against a stricter policy (ADR-071). Headless Chrome loaded 11 pages of a production build with 0 violations
- [ ] a test that an inline script in `contentHtml` does not execute. **Shown once, not yet a suite test:** a one-off headless run of `/blog/<slug>` had its `contentHtml` payloads blocked (`<script>`, a `data:` script, `onerror`, `<style>`). The frontend has no browser runner to hold it
- [x] the certificate PDF frame checked under the new policy (ADR-071 amendment 1). It was not blocked: the document route already sends `frame-ancestors 'self' <CORS_ORIGIN>` and no `X-Frame-Options`, and through the `/api` proxy `'self'` is the page's origin. No code change was needed. `certificateFrame.p708.test.js` pins the headers over the real helmet config: only the verification document is framable, and the verification JSON and the gated `/certificates/:id/pdf` keep `'none'` and `SAMEORIGIN`. Checked live with headless Chrome 154 (real backend on PostgreSQL 18, `next build` + `next start`): the PDF viewer rendered in the frame, and a control frame was refused
- [x] external images decided (ADR-071 amendment 1): **a tenant logo is an uploaded file only**. `img-src` is not widened. The validator refuses a URL or path (400). A stored absolute URL is served as `logoBaseUrl: null` with no migration, so the UI falls back. The signed-in favicon uses the served URL, not the raw `logo`. Tests: `tenant.logoUrl.p708.test.js` (16 of 23 fail against HEAD) and `useTenantBranding.p708.test.tsx` (2 of 2 fail against HEAD). Live: `/login` and `/register` showed the default icons, made no request off the app origin, and had no violation

---

## Phase Exit

- [ ] every task `DONE` with a record
- [ ] a failing scheduled job **wakes somebody**
- [ ] **a failed audit write wakes somebody too** (A-42, via P7-03) — it is the one log line in this system that is itself the compliance record
- [ ] a restore has been **performed**, and the RTO is measured rather than assumed
- [ ] the Helm charts are known to deploy, not only to render
- [ ] a phase summary exists, naming what failed during the drills

**The drills are worth most when something fails.** A phase summary here with an empty "What failed" section means the drills were not real.

# Phase 7 — Operational Maturity

Making failures visible and recovery rehearsed.

Almost everything here is currently **absent rather than incomplete**. Saying so is more useful than describing a monitoring setup that does not exist.

---

### P7-01 — CI pipeline

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Depends on** | **P6-01** — do not build a pipeline around a failing gate |
| **Spec refs** | `docs/DEVOPS/01-CI-CD.md` |

**Why:** the gates currently run in `pre-push` and `make verify`. A local hook can be bypassed with `--no-verify`; a pipeline cannot.

The risk of deferring CI was recorded and is real: skipping it would have silently returned the zero-tolerance IDOR rule to being a sentence in a document — **its enforcement script had no caller other than a pipeline that did not exist.**

**Definition of Done**
- [ ] cheapest signal first: lint, format, typecheck → unit + coverage → secret scan → IDOR enforcement → **route-gate check (P6-04)** → images → migrations **with column verification (P6-05)** → E2E → browser
- [ ] the E2E stage gets rate-limit headroom
- [ ] images pushed only from a green run
- [ ] the same **image** promoted across environments — except the frontend, where `NEXT_PUBLIC_*` forces a rebuild per environment by design

**Abuse cases**
- A stage is marked `continue-on-error` to unblock a release
- The secret scan is allowlisted into uselessness

---

### P7-02 — Alerting on scheduled-job outcomes

| | |
|---|---|
| **Status** | ⏳ TODO — **start here** |
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
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/DEVOPS/06-LOGGING.md` |

**Why:** logs live in container stdout and a volume. Correlating a client symptom with a server line means finding the host first.

**Definition of Done**
- [ ] structured JSON output
- [ ] `X-Request-Id` on every line
- [ ] shipped to an aggregator
- [ ] **redaction verified after shipping** — an aggregator with its own parsing can re-expose a field the application redacted, and a leak into a third-party store is a leak
- [ ] rotation confirmed; a full disk stops writes, including `audit_logs`

**Abuse cases**
- Debug logging is left on in production, which is where redaction discipline slips

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
| **Status** | ⏳ TODO |
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
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/SECURITY/08-API-SECURITY.md` |

**Why:** the API CSP allows `'unsafe-inline'` for scripts because bundled swagger-ui injects inline assets.

**That reasoning does not transfer** to the Next.js origin serving user-authored `posts.contentHtml` — the stored-XSS surface of this system.

**Definition of Done**
- [ ] swagger served with its own relaxed policy, or with a nonce
- [ ] the API default policy tightened to drop `'unsafe-inline'` for scripts
- [ ] the content-rendering origin verified against a stricter policy
- [ ] a test that an inline script in `contentHtml` does not execute

---

## Phase Exit

- [ ] every task `DONE` with a record
- [ ] a failing scheduled job **wakes somebody**
- [ ] a restore has been **performed**, and the RTO is measured rather than assumed
- [ ] the Helm charts are known to deploy, not only to render
- [ ] a phase summary exists, naming what failed during the drills

**The drills are worth most when something fails.** A phase summary here with an empty "What failed" section means the drills were not real.

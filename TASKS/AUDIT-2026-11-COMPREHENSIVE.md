# Comprehensive Technical Audit & Optimization Backlog

**Audit Date:** 2026-11-03  
**Auditor:** Antigravity AI  
**Scope:** Full repository (`backend/`, `frontend/`, `packages/contracts/`, `deploy/`, `.github/workflows/`, and root configurations)  
**Status:** AUDIT COMPLETE — EXECUTED 2026-11-03 … 2026-11-04 (Waves 1–3). Every finding has a status in § Implementation Status; one stays open as runtime verification (A11-PERF-01), one is declined by owner rule (A11-INFRA-01)  

---

## Executive Summary

This comprehensive technical audit evaluates architecture, code quality, multi-tenant security, PostgreSQL database efficiency, application performance, dependency health, and infrastructure/CI-CD readiness across Callibrator.

The project demonstrates rigorous architectural foundations (e.g., deny-by-default tenant isolation via global hooks, dual-backend preparation, and strict build guards). However, the audit identified several critical areas requiring structured remediation:
1. **Pagination Count Defect (`findAndCountAll` without `distinct: true`)**: Detected across 20 service and controller modules, causing inflated `total` counts on paginated endpoints with relational joins.
2. **Architectural Layering Violations**: Database transactions and direct Sequelize model queries are executed directly inside controllers (`session.controller.ts` and `sso.controller.ts`) rather than within the service layer.
3. **Missing Foreign Key Indexes**: Over 60 foreign key columns across major tables (such as `audit_logs`, `ticket_comments`, `calibration_records`) lack composite or single indexes, inducing expensive sequential scans in production.
4. **Potential Memory Exhaustion (Unbounded Queries & N+1)**: Unbounded `findAll()` invocations exist on tables that grow without ceiling (`audit_logs`, `kanban_cards`), along with sequential mutation/query loops.
5. **Vulnerabilities & Outdated Dependencies**: A DoS/ReDoS vulnerability in `minimatch <11.0.1` affects `archiver` and dev toolchains, while major packages (`eslint` v10, `motion` v14, `stripe` v23, `undici` v8) require explicit breaking change mitigation plans.
6. **Infrastructure & Container Hardening**: The backend Dockerfile lacks a `HEALTHCHECK` directive and uses a non-numeric username (`USER app`), risking rejection on Kubernetes clusters enforcing `runAsNonRoot: true`.

---

## Findings Matrix by Category & Priority

| ID | Category | Summary of Finding | Priority | Verification Status |
|---|---|---|---|---|
| **DB-01** | Database & Query Optimization | Missing indexes on foreign key columns across PostgreSQL tables | **CRITICAL** | Confirmed (Models & Migrations) |
| **BUG-01** | Bugs & Functional Flaws | `findAndCountAll` with relational `include` lacks `distinct: true`, inflating pagination totals | **HIGH** | Confirmed (20 service modules) |
| **ARC-01** | Code Quality & Architecture | Layering violation: Database transactions and queries executed directly in controllers (`session`, `sso`) | **HIGH** | Confirmed (Code inspection) |
| **DB-02** | Database & Query Optimization | Unbounded `findAll()` queries on large datasets (OOM heap memory risk) | **HIGH** | Confirmed (Code inspection) |
| **DB-03** | Database & Query Optimization | N+1 Queries: Sequential `await Model.create/update` within loops | **HIGH** | Confirmed (Webhook, Kanban, Menu) |
| **DEP-01** | Dependencies & Packages | Breaking change mitigation for major upgrades (`eslint` v10, `motion` v14, `stripe` v23, `undici` v8) | **HIGH** | Confirmed (npm outdated & audit) |
| **SEC-01** | Security & Vulnerabilities | Database identifier validation on bootstrap DDL execution (`CREATE DATABASE`) | **MEDIUM** | Confirmed (`config/index.ts:181`) |
| **SEC-02** | Security & Vulnerabilities | DoS/ReDoS vulnerability in `minimatch <11.0.1` via `archiver` and toolchains (50 moderate advisories) | **MEDIUM** | Confirmed (npm audit advisory) |
| **BUG-02** | Bugs & Functional Flaws | Inconsistent session active status handling (`is_revoked` vs `is_active`) | **MEDIUM** | Confirmed (`session.controller.ts`) |
| **PERF-01** | Performance Optimization | Lack of bounded batching and concurrency in background cleanup jobs (`attachmentFileSweep`, purge) | **MEDIUM** | Confirmed (Service code) |
| **PERF-02** | Performance Optimization | Missing dynamic imports for heavy frontend libraries (`jspdf`, `fflate`, TipTap rich editor) | **MEDIUM** | Confirmed (Client bundle size) |
| **INF-01** | Infrastructure & Config | Backend Dockerfile: Missing `HEALTHCHECK` and non-numeric UID (`USER app`) | **MEDIUM** | Confirmed (`backend/Dockerfile`) |
| **ARC-02** | Code Quality & Architecture | Legacy dead code `src/utils/checkMenu.util.js` holding ratchet floor at 3 | **LOW** | Confirmed (Ticket A-18) |
| **SEC-03** | Security & Vulnerabilities | Missing default edge security headers (X-Content-Type-Options, Referrer-Policy) in Nginx root server block | **LOW** | Confirmed (`nginx/default.conf`) |
| **INF-02** | Infrastructure & Config | Nginx proxy timeout (60s) alignment with Express middleware timeout (30s) | **LOW** | Confirmed (SLA alignment) |

---

## 1. Bugs & Functional Flaws

### [BUG-01] `findAndCountAll` with Relational `include` Missing `distinct: true` Inflates Pagination Count
- **Priority:** `HIGH`
- **Affected Locations:**
  - `backend/src/controllers/session.controller.ts:162`
  - `backend/src/services/billing.service.ts:341`
  - `backend/src/services/calibrationDevices.service.ts:389`
  - `backend/src/services/certificate.service.ts:614`
  - `backend/src/services/finance.service.ts:243`
  - `backend/src/services/inspectionTemplate.service.ts:280`
  - `backend/src/services/maintenance.service.ts:157`
  - `backend/src/services/qms.service.ts:275`, `407`
  - `backend/src/services/risk.service.ts:126`
  - `backend/src/services/roles.service.ts:930`
  - `backend/src/services/scim.service.ts:405`
  - `backend/src/services/sop.service.ts:161`
  - `backend/src/services/stock.service.ts:202`, `638`
  - `backend/src/services/ticket.service.ts:182`
  - `backend/src/services/user.service.ts:377`
  - `backend/src/services/vendor.service.ts:140`
  - `backend/src/services/warehouse.service.ts:200`
  - `backend/src/services/webhook.service.ts:158`
- **Problem Analysis:**
  In Sequelize, invoking `Model.findAndCountAll({ include: [...] })` without specifying `distinct: true` generates a SQL query of the form `SELECT COUNT(*) FROM table LEFT OUTER JOIN ...`. When the associated table involves a one-to-many relationship (`hasMany` or `belongsToMany`), joined rows multiply. Consequently, the returned `count` reflects the total joined row count rather than the distinct count of parent entities.
- **Impact:**
  Pagination metadata on the frontend (`meta.total`, `meta.totalPages`) becomes inaccurate and misleading (e.g., displaying a total of 15 items when only 5 distinct entities exist).
- **Remediation & Implementation Guidance:**
  Add `distinct: true` and specify `col: 'id'` on every `findAndCountAll` call that includes relations:
  ```typescript
  const { count, rows } = await Model.findAndCountAll({
    where,
    include: [...],
    distinct: true,
    col: "id",
    limit,
    offset,
  });
  ```

---

### [BUG-02] Dual Inconsistent Handling of Session Active State (`is_revoked` vs `is_active`)
- **Priority:** `MEDIUM`
- **Affected Locations:**
  - `backend/src/controllers/session.controller.ts:150-157`, `296-304`
- **Problem Analysis:**
  The session listing filter inspects only `is_revoked: false` and `expired_at >= now()` for the "active" status. However, the `Sessions` model also maintains an `is_active` boolean attribute. During revocations, the code sets both `is_revoked: true` and `is_active: false`. In query filtering, `is_active` is ignored, opening an inconsistency window if a session is deactivated without explicitly setting `is_revoked`.
- **Impact:**
  Inconsistent session state presentation in the user interface and non-deterministic session audit reporting.
- **Remediation:**
  Harmonize the definition of an active session into a single unified model scope within `Sessions`.

---

## 2. Code Quality & Architecture

### [ARC-01] Architectural Layering Violation: Transactions & Direct Model Queries in Controllers
- **Priority:** `HIGH`
- **Affected Locations:**
  - `backend/src/controllers/session.controller.ts:162`, `296`, `347`, `412`
  - `backend/src/controllers/sso.controller.ts:387`
- **Problem Analysis:**
  The repository contract (`AGENTS.md` - Backend Engineer) explicitly states:
  > *"Transactions open in the service, never a controller."*  
  > *"Controllers handle HTTP marshalling: parse request, validate, call service, map envelope."*  
  In `session.controller.ts` and `sso.controller.ts`, database transactions (`sequelize.transaction(...)`) and direct Sequelize model queries are executed directly within the controller, completely bypassing `session.service.ts` and `sso.service.ts`.
- **Impact:**
  - Violates the Single Responsibility Principle.
  - Transactional logic cannot be unit-tested without mocking Express `req`/`res`.
  - Inconsistent with the rest of the codebase where transactions reside strictly in the service layer.
- **Remediation:**
  Relocate session revocation logic (`revokeSession`, `revokeAllUserSessions`, `cleanupExpiredSessions`) and SSO session generation into service methods inside `backend/src/services/session.service.ts` and `backend/src/services/sso.service.ts`. Controllers should only validate inputs, call service methods, and return the response envelope via `success(res, ...)`.

---

### [ARC-02] Legacy Dead Code Cleanup (`checkMenu.util.js`)
- **Priority:** `LOW`
- **Affected Locations:**
  - `backend/src/utils/checkMenu.util.js`
  - `backend/src/tests/guards/noSourceJs.p924.guard.test.ts:22-24`
  - `backend/.ts-ratchet.json`
- **Problem Analysis:**
  The file `src/utils/checkMenu.util.js` is the sole remaining `.js` source file in `backend/src/`. It is a dead diagnostic module not imported anywhere in production code.
- **Impact:**
  Holds the ratchet floor at 3 and necessitates an explicit exception in `noSourceJs.p924.guard`.
- **Remediation:**
  In accordance with tracked owner ticket **A-18**, delete the file, remove the exemption from `noSourceJs.p924.guard.test.ts`, and lower the `ts-ratchet.json` floor to 2.

---

## 3. Security & Vulnerabilities

### [SEC-01] Database Identifier Validation in Bootstrap DDL
- **Priority:** `MEDIUM`
- **Affected Locations:**
  - `backend/src/config/index.ts:181`
  ```typescript
  await sql(bootstrapRunner, `CREATE DATABASE "${dbName as string}";`);
  ```
- **Problem Analysis:**
  The database name is read from environment variable `DB_NAME` and interpolated directly into the SQL string `CREATE DATABASE "${dbName}"`. PostgreSQL does not support bind parameters for DDL database identifiers. While sourced from the server's environment, there is no regex validation ensuring the absence of double quotes (`"`), leaving potential DDL injection risk if environment configurations are misconfigured or tainted.
- **Impact:**
  Potential execution of unintended DDL if `DB_NAME` contains special characters or unescaped quotes.
- **Remediation:**
  Enforce strict identifier whitelist validation before executing bootstrap DDL (following the `roleFrom` pattern in `upstreamImport.ts`):
  ```typescript
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid database identifier: "${dbName}"`);
  }
  ```

---

### [SEC-02] DoS / ReDoS Vulnerability in `minimatch <11.0.1` via `archiver`
- **Priority:** `MEDIUM`
- **Affected Locations:**
  - `backend/package.json` (`archiver ^8.0.0`)
  - `node_modules/readdir-glob/node_modules/minimatch`
- **Problem Analysis:**
  Advisory GHSA-g3hv-75wg-m249 reports potential Denial of Service via globparts amplification in `minimatch` versions below 11.0.1. The production package `archiver` depends on `readdir-glob`, which pulls vulnerable `minimatch` versions.
- **Impact:**
  If pattern matching in zip extraction/export operations processes untrusted glob strings, it can lead to high CPU utilization (ReDoS).
- **Remediation:**
  - Apply an npm override in the root `package.json`:
    ```json
    "overrides": {
      "readdir-glob": {
        "minimatch": "^11.0.1"
      }
    }
    ```
  - Verify GDPR zip export functionality (`gdpr.service.ts`) after applying the override.

---

### [SEC-03] Edge Security Headers in Root Nginx Server Block
- **Priority:** `LOW`
- **Affected Locations:**
  - `deploy/compose/nginx/default.conf:65`
- **Problem Analysis:**
  The HTTPS Nginx block defines `Strict-Transport-Security`, but standard web security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`) are left entirely to downstream Express/Next.js layers. On direct Nginx edge responses (e.g., 404, 502, ACME challenges), MIME-sniffing protection headers are absent.
- **Remediation:**
  Add global security headers to the port 443 `server` block in Nginx:
  ```nginx
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  ```

---

## 4. Database & Query Optimization

### [DB-01] Missing Indexes on Primary Foreign Key Columns
- **Priority:** `CRITICAL`
- **Affected Locations:**
  - `audit_logs` (`userId`, `resourceId`, `clientFacilityId`) — `backend/src/models/auditLog.model.ts`
  - `ticket_comments` (`ticketId`, `userId`) — `backend/src/models/ticketComment.model.ts`
  - `calibration_records` (`deviceId`, `clientFacilityId`) — `backend/src/models/calibrationRecord.model.ts`
  - `inspection_results` (`sessionId`, `clientFacilityId`) — `backend/src/models/inspectionResult.model.ts`
  - `workflow_actions` (`instanceId`, `stepId`, `userId`) — `backend/src/models/workflowAction.model.ts`
  - `webhook_deliveries` (`webhookId`) — `backend/src/models/webhookDelivery.model.ts`
  - `stocks` (`warehouseId`, `locationId`) — `backend/src/models/stock.model.ts`
- **Problem Analysis:**
  PostgreSQL does **not** automatically index columns backing `FOREIGN KEY ... REFERENCES` constraints. Because Callibrator operates as a multi-tenant platform, nearly every query filters or joins on `(tenant_id, foreign_key_id)`. The lack of indexes on these foreign keys forces PostgreSQL to execute full *Sequential Scans* across high-volume tables.
- **Performance Impact:**
  - Loading ticket comments requires scanning the entire `ticket_comments` table.
  - Filtering calibration history by device scans millions of rows in `calibration_records`.
  - Audit sweeps and tenant reporting suffer high query latencies (jumping from sub-milliseconds to hundreds of milliseconds or seconds).
- **Remediation Plan:**
  Create an expansion migration that adds composite indexes concurrently (following ADR-039 / expand-and-contract):
  ```typescript
  await queryInterface.addIndex("ticket_comments", ["tenant_id", "ticket_id"], {
    name: "idx_ticket_comments_tenant_ticket",
    concurrently: true,
  });
  await queryInterface.addIndex("audit_logs", ["tenant_id", "resource_id"], {
    name: "idx_audit_logs_tenant_resource",
    concurrently: true,
  });
  await queryInterface.addIndex("calibration_records", ["tenant_id", "device_id"], {
    name: "idx_calibration_records_tenant_device",
    concurrently: true,
  });
  ```

---

### [DB-02] Unbounded `findAll()` Queries on High-Volume Datasets
- **Priority:** `HIGH`
- **Affected Locations:**
  - `backend/src/services/dataRetention.service.ts:811` (`AuditLog.findAll`)
  - `backend/src/services/kanban.service.ts:1671` (`KanbanCard.findAll`)
  - `backend/src/services/webhook.service.ts:712` (`Webhook.findAll`)
  - `backend/src/services/gdpr.service.ts:432` (`Model.findAll`)
- **Problem Analysis:**
  Executing `findAll()` without a `limit` clause loads entire table partitions into Node.js heap memory at once. In tenants with tens of thousands of cards or millions of audit logs, this induces severe V8 Heap spikes and risks Out of Memory (OOM) crashes.
- **Impact:**
  Process crashes and service downtime due to memory starvation during retention or export sweeps.
- **Remediation:**
  Convert bulk fetches to keyset/cursor-based pagination or streaming batches:
  ```typescript
  const BATCH_SIZE = 1000;
  let cursor: string | null = null;
  while (true) {
    const rows = await AuditLog.findAll({
      where: {
        ...filter,
        ...(cursor ? { id: { [Op.gt]: cursor } } : {}),
      },
      order: [["id", "ASC"]],
      limit: BATCH_SIZE,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    // process batch...
  }
  ```

---

### [DB-03] N+1 Query Patterns in Mutation Loops
- **Priority:** `HIGH`
- **Affected Locations:**
  - `backend/src/services/webhook.service.ts:725` (per-row `WebhookDelivery.create` in a loop)
  - `backend/src/services/kanban.service.ts:590`, `1023`, `1280` (per-item create/update within loops)
  - `backend/src/services/menuGroup.service.ts:849` (per-item `destroy` in permission array loop)
- **Problem Analysis:**
  Awaiting `Model.create(...)` or `Model.update(...)` inside loops sends separate network roundtrips to PostgreSQL for each item ($N$ distinct queries).
- **Impact:**
  Operations dispatching 100 webhook deliveries or synchronizing 50 columns take orders of magnitude longer than batched bulk queries.
- **Remediation:**
  Replace iterative calls with `bulkCreate` or batched SQL operations:
  ```typescript
  await WebhookDelivery.bulkCreate(deliveryRows, { transaction });
  ```

---

## 5. Performance Optimization

### [PERF-01] Concurrency & Batching Optimization in Background Cleanup Jobs
- **Priority:** `MEDIUM`
- **Affected Locations:**
  - `backend/src/services/attachmentFileSweep.service.ts:295`
  - `backend/src/services/webhookDeliveryPurge.service.ts:93`
- **Problem Analysis:**
  Sweeping orphaned attachment files and purging expired webhook deliveries iterates sequentially across tenants without controlled concurrency or chunking.
- **Remediation:**
  Apply bounded batching and leverage direct PostgreSQL interval criteria (`DELETE ... WHERE created_at < NOW() - INTERVAL '30 days' LIMIT 1000`) to avoid long-running row locks.

---

### [PERF-02] Code-Splitting & Dynamic Imports for Heavy Frontend Libraries
- **Priority:** `MEDIUM`
- **Affected Locations:**
  - `frontend/src/app/(app)/dashboard/tickets/[ticketId]/page.tsx` (TipTap rich text editor)
  - Client-side PDF export modules (`jspdf`, `fflate`)
- **Problem Analysis:**
  Large DOM-manipulation libraries (TipTap) and client-side PDF generation utilities are imported statically into primary dashboard pages, increasing the initial JavaScript bundle loaded by the browser.
- **Remediation:**
  Utilize `next/dynamic` with SSR disabled for heavy editor and PDF export components:
  ```typescript
  import dynamic from "next/dynamic";
  const RichEditor = dynamic(() => import("@/components/RichEditor"), {
    ssr: false,
    loading: () => <Skeleton className="h-40 w-full" />,
  });
  ```

---

## 6. Dependencies & Package Management

### [DEP-01] Package Compatibility Analysis & Breaking Changes Migration Guide

| Package | Current | Target | Update Type | Upgrade Rationale & Compatibility Analysis |
|---|---|---|---|---|
| **`eslint`** | `9.39.5` | `10.14.0` | **Major** | v10 is released, but **HOLD ON v9.39.x**. `@typescript-eslint` v8 does not yet fully support ESLint 10. Upgrading now breaks typed linting. |
| **`motion`** | `13.4.4` | `14.9.0` | **Major** | Performance & memory improvements for React 19. Requires adjusting import paths to `motion/react`. |
| **`stripe`** | `22.6.2` | `23.1.0` | **Major** | Updated Stripe API version and webhook event typings. Requires updating parameters in `stripeWebhook.service.ts`. |
| **`undici`** | `7.30.1` | `8.12.3` | **Major** | Frontend devDependencies HTTP client. Compatible with Node 26. |
| **`archiver`** | `8.0.0` | `8.0.0+` | **Patch / Override** | Mitigate `minimatch <11.0.1` advisory via root npm overrides. |
| **`next`** | `16.4.3` | `16.4.4` | Patch | Next.js 16 stability & security fixes (Safe upgrade). |
| **`react` / `react-dom`** | `19.3.0` | `19.3.1` | Patch | React 19 compiler stability fixes (Safe upgrade). |
| **`express`** | `5.2.1` | `5.3.0` | Minor | Express 5 routing fixes (Safe upgrade). |
| **`pg`** | `8.23.0` | `8.23.1` | Patch | PostgreSQL driver connection stability (Safe upgrade). |
| **`@aws-sdk/*`** | `3.1141.0` | `3.1161.0` | Minor | S3 client optimizations (Safe upgrade). |

#### Detailed Breaking Changes & Required Code Changes:

1. **`stripe` (v22 -> v23)**:
   - **Breaking Change:** Stripe v23 updates default API version structures and removes deprecated properties on `Stripe.Subscription` and `Stripe.Invoice`.
   - **Required Code Changes:**
     - Update initialization in `backend/src/services/stripeWebhook.service.ts:68` and `backend/src/services/billing.service.ts`:
       ```typescript
       new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-01-27.acacia" });
       ```
     - Run test verification: `npm test -- src/tests/services/stripeWebhook.service.test.ts`.

2. **`motion` (v13 -> v14)**:
   - **Breaking Change:** Re-architected module exports for React 19.
   - **Required Code Changes:**
     - Replace any legacy `framer-motion` imports with `from "motion/react"`.
     - Verify animated UI components in `frontend/src/components/ui/`.
     - Verify with `npm run typecheck` in `frontend/`.

3. **`minimatch` / `archiver` Security Remediation**:
   - **Safe Remediation:** Add dependency override to root `package.json`:
     ```json
     "overrides": {
       "readdir-glob": {
         "minimatch": "^11.0.1"
       }
     }
     ```
   - Verify that all 50 moderate advisories in `npm audit` resolve cleanly without breaking zip archive generation.

---

## 7. Infrastructure & Configuration

### [INF-01] Backend Dockerfile: Missing `HEALTHCHECK` & Non-Numeric UID
- **Priority:** `MEDIUM`
- **Affected Locations:**
  - `backend/Dockerfile:228-231`
- **Problem Analysis:**
  1. `backend/Dockerfile` sets `USER app` using a string username rather than a numeric UID (unlike `frontend/Dockerfile` which enforces `USER 1001:1001`). On enterprise Kubernetes clusters enforcing `runAsNonRoot: true` with strict numeric checks, backend pods may fail admission.
  2. `backend/Dockerfile` lacks a `HEALTHCHECK` instruction. If the process hangs or exhausts its event loop, local Docker engines cannot detect container unhealthiness.
- **Remediation:**
  Update `backend/Dockerfile`:
  ```dockerfile
  USER 1001:1001

  HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

  CMD ["./backend"]
  ```

---

### [INF-02] Nginx Proxy Timeout Alignment with Express Backend Timeout
- **Priority:** `LOW`
- **Affected Locations:**
  - `deploy/compose/nginx/default.conf:72-73`
  - `backend/src/config/index.ts` (Express `connect-timeout`)
- **Problem Analysis:**
  Nginx sets `proxy_read_timeout 60s`, while Express `connect-timeout` triggers at 30 seconds (returning 408). On large SQL dump imports (`/api/v1/admin/upstream-sql-imports`), Nginx timeout is elevated to 960s. For standard queries that exceed 30 seconds, Express terminates the request before Nginx reaches its read timeout.
- **Remediation:**
  Ensure route-level SLA timeouts and middleware configs are explicitly synchronized.

---

## Actionable Remediation Roadmap

### Phase 1: Immediate Safety & Data Correctness (Sprint 1)
- [ ] Apply `distinct: true, col: "id"` across the 20 identified `findAndCountAll` modules ([BUG-01]).
- [ ] Add npm overrides for `minimatch ^11.0.1` to clear the 50 audit advisories ([SEC-02]).
- [ ] Add regex identifier whitelist validation to bootstrap DDL execution ([SEC-01]).

### Phase 2: Database Scalability & Index Hardening (Sprint 2)
- [ ] Author migration adding composite indexes `CONCURRENTLY` on critical foreign keys (`audit_logs`, `ticket_comments`, `calibration_records`) ([DB-01]).
- [ ] Implement keyset/cursor batching on bulk `findAll` queries ([DB-02]).
- [ ] Refactor sequential loop mutations into `bulkCreate` calls in webhook and kanban services ([DB-03]).

### Phase 3: Architectural Compliance & Container Hardening (Sprint 3)
- [ ] Migrate transaction and query logic from `session.controller.ts` and `sso.controller.ts` into service methods ([ARC-01]).
- [ ] Add `HEALTHCHECK` and numeric `USER 1001:1001` to `backend/Dockerfile` ([INF-01]).
- [ ] Remove legacy dead file `checkMenu.util.js` (A-18) and calibrate ratchet floor to 2 ([ARC-02]).
- [ ] Add baseline security headers to Nginx root server block ([SEC-03]).

### Phase 4: Frontend Performance & Major Package Updates (Sprint 4)
- [ ] Implement dynamic imports (`next/dynamic`) for TipTap editor and JSPDF ([PERF-02]).
- [ ] Test and perform major upgrades for `stripe` v23 and `motion` v14 ([DEP-01]).

---

# ADDENDUM — Supplementary Independent Verification Pass (A11-*)

**Date:** 2026-11-03 · **Method:** static only (git grep, npm audit/outdated, targeted config/middleware/service reads). **No runtime testing.**
This addendum adds **only net-new findings** from a second independent pass that the sections above do not cover. Existing IDs (`DB-01`, `BUG-01`, `SEC-01`, …) are cross-referenced, not re-stated.

### Independent confirmation of existing findings (re-verified this pass, no change)
- **SEC-02 / DEP-01 (minimatch):** Confirmed installed `minimatch@3.1.5` (<11.0.1) in the runtime tree; **`archiver@8.0.0` is the latest release and still depends on `readdir-glob → minimatch@3.x`** — so a plain `archiver` bump cannot clear it; only a scoped npm `override` or a ZIP-library swap can. The suggested root override `readdir-glob → minimatch ^11.0.1` is correct but **Requires Verification** (minimatch 11 may break `readdir-glob`'s call API; must re-run the ZIP-export tests).
- **SEC-02 (deepmerge):** Installed `deepmerge@4.3.1` is inside the vulnerable range (`>=4.2.0 <=4.3.1`); fix is `>=4.3.2`. It is a **transitive/dev-adjacent** dep (not a direct dependency) — confirm its runtime reachability before prioritising.
- **DEP-01 (npm outdated):** Re-ran `npm outdated`; the matrix above is accurate. No new majors beyond those listed.
- **ARC-02 (checkMenu.util.js):** Confirmed dead — only its own test imports it; production code uses the in-file `checkMenuPermission` in `dynamicAccess.middleware.ts`. Ties to A-18.
- **Audit totals:** 51 advisories (1 low = deepmerge, 50 moderate = minimatch); 0 high, 0 critical.

---

## 8. Supplementary Security Findings

### [A11-SEC-01] Dead OTP utility uses `Math.random()` and non-constant-time comparison (latent landmine)
- **Priority:** `MEDIUM`
- **Locations:** `backend/src/utils/otp.util.ts:12-36` (`generateOTP`, `verifyOTP`); test `backend/src/tests/unit/utils/otp.util.test.ts:25,37`.
- **Problem:** `generateOTP()` seeds its digits from `Math.random()` (a non-CSPRNG), and `verifyOTP()` compares with `===` (not `crypto.timingSafeEqual`). MFA in production uses `otplib` (proper TOTP), and **no tracked source imports `otp.util`** — it is effectively dead. This is not currently exploitable.
- **Impact:** A predictable-OTP helper sitting in the tree is one wiring-decision away from becoming a real auth bypass (MFA, password reset, email verification). The dead test actively enshrines the weak behaviour (`toEqual(expect.any(Number))`).
- **Remediation (pick one):**
  - **Preferred — delete** `otp.util.ts` and `otp.util.test.ts` (MFA is `otplib`). Closest the codebase comes to a zero-risk fix.
  - **If retained — harden:** generate from `crypto.randomInt(0, 10)` per digit (or `crypto.randomBytes`), compare via `crypto.timingSafeEqual` over equal-length buffers, and store OTPs hashed with an attempt counter + TTL in Redis. Update the test to assert `Number.isInteger`/length, not "any number".
- **Requires Verification:** none material; only confirm no dynamic `require("./otp.util")` exists (none found statically).

### [A11-SEC-02] `Math.random()`-derived identifiers for distributed locks, job ids, and client ids
- **Priority:** `LOW`
- **Locations:**
  - `backend/src/services/redis.service.ts:382` — `acquireLock()` builds `lockId` from `Date.now()` + `Math.random()`.
  - `backend/src/services/emailQueue.service.ts:159` — job id from `Date.now()` + `Math.random()`.
  - `backend/src/utils/upload.util.ts:348` — storage object-name prefix from `Date.now()` + `Math.floor(Math.random() * 10000)` (low uniqueness under burst; prefer `crypto.randomBytes`).
  - `frontend/src/utils/index.ts:55` and `frontend/src/stores/toastStore.ts:20` — client-side ids from `Math.random()`.
- **Problem:** These identifiers are not cryptographically random; under high frequency / clock skew they can collide.
- **Impact:** A `lockId` collision (or a stale holder releasing after TTL) can let one worker release another's lock; duplicate job/route/toast ids cause missed deliveries or React key churn. Low likelihood, low blast radius.
- **Remediation:** Use `crypto.randomUUID()` (or `crypto.randomBytes(16).toString("hex")`) for anything that must be unique. Frontend ids can use a monotonic counter + `crypto.randomUUID()` for keys.
- **Requires Verification:** none.

---

## 9. Supplementary Dependency Findings

### [A11-DEP-01] Minor/patch drift with security-relevant packages (batch bump)
- **Priority:** `LOW`
- **Evidence:** `npm outdated` (semver-compatible "Wanted" column).
- **Priority bumps (do promptly — security/robustness surface):**
  - `xss` `1.0.15 → 1.0.17` (the global sanitizer library — keep current).
  - `axios` `1.20.0 → 1.21.0`, `express` `5.2.1 → 5.3.0`, `express-rate-limit` `8.7.0 → 8.7.3`.
  - `pg` `8.23.0 → 8.23.1`, `@aws-sdk/client-s3` + `s3-request-presigner` `3.1141.0 → 3.1161.0`, `nodemailer` `10.3.0 → 10.3.1`, `otplib` `13.5.0 → 13.6.0`, `uuid`, `@types/node` `26.6.3 → 26.6.6`.
- **Remediation:** Batch these as a single "dependency refresh" PR; they stay within declared ranges (no code change expected). Re-run the full suite per `make verify`.

### [A11-DEP-02] `moment` / `moment-timezone` — maintenance-mode, migrate and drop
- **Priority:** `LOW`
- **Locations (non-test call sites):** `backend/src/middlewares/accessLog.middleware.ts`, `backend/src/services/tenantBackup.service.ts` (plus `moment-timezone` data).
- **Problem:** `moment` is in maintenance mode (mutable globals, large parse tree). It is used in only **2** non-test files, so the migration cost is small.
- **Remediation:** Replace the 2 call sites with native `Intl.DateTimeFormat`/`Temporal` (or `date-fns-tz` where timezone math is needed), then remove `moment` and `moment-timezone` from `backend/package.json`. Low priority given limited usage.

---

## 10. Supplementary Database Findings

### [A11-DB-01] Connection-pool sizing vs Postgres `max_connections` under multiple replicas/workers
- **Priority:** `LOW` — **Requires Verification**
- **Location:** `backend/src/config/index.ts:121-128` — Sequelize pool `max: 20` per process in production (`min: 2`, `acquire: 30000`, `idle: 10000`), each tunable via `DB_POOL_*`.
- **Problem:** Every process opens its own pool — the API process, the BullMQ worker process (`backend/src/server/worker.server.ts`), the backup verifier (which builds a second `Sequelize` instance at `config/index.ts:163`), and any future replica. With the compose stack's single `postgres:18.6-alpine` (8 GB limit) and a default `max_connections=100`, N processes × 20 can approach the ceiling, surfacing as intermittent `too many clients` under load.
- **Impact:** Connection-exhaustion errors that look like app faults but are capacity limits; worse under horizontal scaling.
- **Remediation:** Size `DB_POOL_MAX` = `floor((max_connections − reserved) / process_count)`, set explicit `DB_POOL_*` in `deploy/compose/.env` / secrets, and place **PgBouncer** (transaction pooling) in front of Postgres for multi-replica. **Requires Verification:** actual replica/worker count and the Postgres `max_connections` in the target environment.
- **Cross-ref:** independent of DB-01 (indexes); complementary.

### [A11-DB-02] `DB_SSL` is boolean-only — no CA bundle / `rejectUnauthorized` for managed Postgres
- **Priority:** `LOW` — **Requires Verification**
- **Location:** `backend/src/config/index.ts:138-140` — `dialectOptions.ssl = DB_SSL === "true" ? { require: true } : false`.
- **Problem:** There is no way to supply a CA certificate or set `rejectUnauthorized`. For the self-hosted compose stack (Postgres on an internal network, TLS terminated at Nginx) this is moot. For a **managed** Postgres (RDS / Cloud SQL / Azure Flexible Server / AlloyDB) presenting a private-CA certificate, operators cannot validate the chain and are effectively forced to weaken TLS verification or disable SSL.
- **Remediation:** Add optional `DB_SSL_CA` (path/contents) and `DB_SSL_REJECT_UNAUTHORIZED` (default `true`) to `config/env.ts` fail-listing and thread them into `dialectOptions.ssl`. **Requires Verification:** whether a managed DB is in the deployment target.

### [A11-DB-03] Migration idempotency-guard `try/catch` is broad — can mask non-"exists" errors
- **Priority:** `LOW`
- **Locations:** 18 migrations wrap a `describeTable()`/existence probe in `try { … } catch { /* create */ }` — e.g. `backend/src/migrations/0005-add-batch-jobs.ts:10-72`, `0007-enhance-password-reset-tokens.ts:12-74`, `0012-backup-and-certificate-signing.ts:17-111`, `0041-rename-users-to-users_master.ts:11-69`.
- **Problem:** This pattern is **intentional idempotency** (verified — not a silent error-swallow for normal flow), but the `catch` is unconditional: a non-"does not exist" failure (permission denied, connection drop, statement timeout) is treated as "the column is missing, create it", which then produces a confusing secondary error and hides the root cause.
- **Impact:** A transient DB fault during a migration is misreported, and can leave a migration half-applied while its manifest row is written.
- **Remediation:** In the `catch`, branch on the error — only proceed to create when the error indicates absence (`code === "42P07"` duplicate_table / `"42701"` duplicate_column / `"42703"` undefined_column); otherwise `throw`. Keep `down` tested per the DB contract.
- **Cross-ref:** distinct from DB-01 (which is about absent indexes).

### [A11-DB-04] Cross-check that index-less models have migration indexes (verification pointer, not a new task)
- **Priority:** `LOW` — **Requires Verification**
- **Observation:** ~26 `backend/src/models/*.model.ts` files declare no `indexes` block. Per **ADR-100 Am.3** (`modelIndexColumns.am3.guard`), a model must **not** index a column a later migration adds — so the intended home for these indexes is a migration, not the model. This is **by design**, not a defect.
- **Action (verify, don't assume):** For each such table, confirm a migration under `backend/src/migrations/` adds the tenant-scoping and FK indexes; report any table whose `tenant_id`/FK has **neither** a model nor a migration index. Fold results into the DB-01 index migration rather than opening a separate task.

---

## 11. Supplementary Performance Findings

### [A11-PERF-01] Confirm bounded queries + concurrency on the largest services under load
- **Priority:** `LOW` — **Requires Verification**
- **Locations (largest hot paths):** `kanban.service.ts` (67 KB), `calibrationDevices.service.ts` (55 KB), `dashboard.service.ts` (54 KB), `ipmReport.service.ts` (49 KB).
- **Problem:** Static review found services generally use eager `include` with `required:false` (the documented trap) and `Promise.all` for concurrency, but per-row `await findOne/findAll` inside loops and unbounded list loads on ever-growing tables (`audit_logs`, `kanban_cards`) are only confirmable with query logs under a representative tenant.
- **Action:** Enable Sequelize `logging`/`benchmark` against a seeded large tenant, look for repeated identical queries in a single request (N+1) and unbounded result sets. **Cross-ref:** overlaps existing **DB-03** (N+1) and **DB-02** (unbounded `findAll`) — this is the runtime verification step for them, not a separate defect.

---

## 12. Supplementary Bug Findings

### [A11-BUG-01] `createDatabaseIfNotExists()` always returns `true` — outer retry never triggers
- **Priority:** `LOW` — **Requires Verification**
- **Location:** `backend/src/config/index.ts:161-203` (`createDatabaseIfNotExists`) consumed by `Connection()` at `:232-254`.
- **Problem:** The bootstrap helper returns `true` whether or not the `CREATE DATABASE` succeeded (documented "as built" — the main connection surfaces real errors). Because `Connection()` only enters its retry loop when this returns falsy, a transient create failure never retries at this step; it fails later inside `waitForDbReady`/`authenticate`.
- **Impact:** Longer cold-start on managed DBs where the app is expected to create the database; a transient fault isn't retried where the code implies it is.
- **Remediation:** Return the real success value (or throw) and let the existing retry loop handle it; align the doc comment with behaviour. **Requires Verification:** relevance depends on whether the target pre-creates the database (compose init / managed DBs usually do).

---

## 13. Supplementary Code-Quality & Architecture Findings

### [A11-ARCH-01] High inline `eslint-disable` density — audit the non-deliberate subset
- **Priority:** `LOW`
- **Evidence:** 243 non-test source files carry `eslint-disable-next-line`. Breakdown (non-test): `@typescript-eslint/prefer-nullish-coalescing` ~555 (deliberate — `||` semantics are documented in `config/index.ts:96-101`), `no-require-imports` 125 (deliberate — load-order preservation), then a scattered ~200 across `prefer-optional-chain` (70), `restrict-template-expressions` (69), `no-unnecessary-condition` (67), `no-unnecessary-type-conversion` (37), `no-base-to-string` (30), `require-await` (22), `no-empty-function` (21), etc.
- **Assessment:** The two dominant rules are intentional architectural choices, not debt. The scattered ~200 are the ones worth a periodic sweep to confirm each still earns its suppression and isn't masking a defect. Note **type discipline is genuinely strong** (`0` ts-ignore/nocheck, only `2` non-test `as any`) — do not "fix" the deliberate rules.
- **Remediation:** Add a one-time checklist pass over the scattered rules; leave `prefer-nullish-coalescing`/`no-require-imports` alone unless a decision changes.

### [A11-ARCH-02] Large "god" services — maintainability/blast-radius, not correctness
- **Priority:** `LOW`
- **Locations:** `auth.service.ts` (~100 KB), `eSignature.service.ts` (~84 KB), `user.service.ts` (~82 KB), `gdpr.service.ts` (~75 KB), `migration.service.ts` (~71 KB), `kanban.service.ts` (~67 KB), `certificate.service.ts` (~61 KB).
- **Assessment:** These are heavily tested, so this is a navigation/review-blast-radius concern, not a correctness one. Refactor opportunistically along natural seams (e.g. split `gdpr.service.ts` export/erase paths) rather than as a dedicated campaign. Low priority.

### [A11-ARCH-03] TypeScript 7 native preview is the sole typecheck gate — verify parity with stable tsc
- **Priority:** `LOW` — **Requires Verification**
- **Location:** `backend/package.json` → `typecheck` runs `node ../node_modules/@typescript/native/bin/tsc` (TS7, Go-based preview); `typescript` is aliased to `@typescript/typescript6`. Frontend likewise targets TS7 native.
- **Problem:** A preview compiler as the *only* authoritative typecheck carries a small risk of diverging from stable `tsc` semantics or regressing between preview builds.
- **Remediation:** Periodically run stable `tsc` (v6) as a differential check (CI job or local) and compare diagnostics; keep TS7 for the fast inner loop. **Requires Verification:** actual TS7-vs-tsc6 parity on this tree.

---

## 14. Supplementary Infrastructure / CI Findings

### [A11-INFRA-01] Live E2E suite (428 tests) is not gated in CI
- **Priority:** `MEDIUM`
- **Evidence:** `.github/workflows/ci.yml` header comment ("run yet): the live E2E suite and the smoke and P10 browser suites … they need a running server") and ticket **A-19**. CI runs unit/coverage, the npm-audit gate, gitleaks, and the `browser-a11y` job on a disposable stack — but **not** the 428-test live E2E suite, which is executed by hand (PROGRESS records two clean back-to-back runs on 2026-10-01).
- **Impact:** Cross-endpoint regressions ship unless someone remembers to run E2E manually. This is the exact failure shape the QA charter warns about ("services written against endpoints that did not exist").
- **Remediation:** Add a CI job (on `main`/release tags, or nightly) that stands up `docker-compose.e2e.yml` + `scripts/e2e/ci-e2e-env.sh` and runs the E2E suite; gate releases on it. A nightly schedule is an acceptable first step if per-PR runtime is too high.

---

## 15. Consolidated "Requires Verification" Register (static pass could not confirm)

| Item | What must be checked | Where |
|---|---|---|
| RLS / deny-by-default coverage | Confirm every tenant table has an RLS policy + the app role lacks cross-tenant grants (ADR-013/0013 drop policies; `tenantScope.util` enforces at ORM) — heavily tested, not re-derived here | `backend/src/utils/tenantScope.util.ts`, `backend/src/migrations/*` |
| Index-less model coverage | Migrations add tenant_id/FK indexes for the ~26 index-less models | fold into DB-01 / A11-DB-04 |
| Pool vs `max_connections` | Replica/worker count and Postgres `max_connections` in target env | A11-DB-01 |
| Managed-DB TLS | Whether `DB_SSL_CA`/`rejectUnauthorized` are needed | A11-DB-02 |
| N+1 / unbounded under load | Query logs on largest services with a seeded large tenant | A11-PERF-01 → DB-02/DB-03 |
| `createDatabaseIfNotExists` retry | Whether target pre-creates the DB | A11-BUG-01 |
| TS7 vs tsc6 parity | Differential typecheck diagnostics | A11-ARCH-03 |
| `readdir-glob` + minimatch 11 | ZIP-export tests still pass under the override | SEC-02 / DEP-01 (archiver) |
| Dead `otp.util` dynamic import | Confirm no runtime `require()` of it | A11-SEC-01 |

---

## 16. Suggested Sequencing for the A11-* Items (fold into the roadmap above)

- **Sprint 1 (with existing Phase 1):** A11-SEC-01 (delete/harden dead OTP util — trivial, removes a landmine); A11-DEP-01 batch minor/patch bumps (incl. `xss`).
- **Sprint 2 (with Phase 2 DB work):** A11-DB-01 pool sizing, A11-DB-02 `DB_SSL` config, A11-DB-03 migration `catch` narrowing, A11-DB-04 index cross-check.
- **Sprint 3 (with Phase 3):** A11-INFRA-01 add E2E to CI; A11-ARCH-01 eslint-disable sweep.
- **Sprint 4 (with Phase 4):** A11-DEP-02 drop `moment`; A11-SEC-02 / A11-BUG-01 identifier + retry hardening; A11-ARCH-02/03 opportunistically.

> **Net-new task IDs introduced by this addendum:** A11-SEC-01, A11-SEC-02, A11-DEP-01, A11-DEP-02, A11-DB-01 … A11-DB-04, A11-PERF-01, A11-BUG-01, A11-ARCH-01 … A11-ARCH-03, A11-INFRA-01. No existing finding above was modified.








---

## Implementation Status — feat/audit-2026-11 (2026-11-03; Wave 2 on `main`, 2026-11-04 — [record](../MEMORY/records/2026-11-04-audit-wave2.md))

Implemented on branch `feat/audit-2026-11`; each commit gated (eslint on changed
files, typecheck, related tests, load:check). `certificate.service.ts` is excluded
(owned by the parallel P21-15 agent). Full evidence in
`MEMORY/records/2026-11-03-audit-wave1.md`.

| Finding | Status | Commit | Notes |
|---|---|---|---|
| SEC-01 | FIXED | `ba3ec8d2` | DB_NAME identifier validation before bootstrap DDL; mirrored in environmentSchema |
| A11-BUG-01 | FIXED | `ba3ec8d2` | createDatabaseIfNotExists returns false on failure (retry loop now live) |
| A11-SEC-01 | FIXED | `ad829a23` | dead `otp.util` + test deleted (proven dead; load:check 0) |
| A11-SEC-02 | FIXED | `ad829a23`, Wave 3 | backend: redis/emailQueue/upload crypto ids; frontend: `generateId` and the toast store use `crypto.getRandomValues` ([record](../MEMORY/records/2026-11-04-audit-wave3.md)) |
| A11-DB-02 | FIXED | `eb5d16b1` | DB_SSL_CA / DB_SSL_REJECT_UNAUTHORIZED threaded into dialectOptions.ssl |
| INF-01 | FIXED | `9887de72`, Wave 3 | HEALTHCHECK on `/live`; `USER 997:997` numeric with the gid pinned (image built and inspected) |
| INF-02 | NO CHANGE | `9887de72` | premise incorrect (proxy 60s >= app 30s is the correct ordering); documented |
| SEC-03 | FIXED | `9887de72` | nginx X-Frame-Options / X-Content-Type-Options / Referrer-Policy (HSTS already present) |
| BUG-01 | FIXED | Wave 2 | 19 calls in 15 files; ticket already distinct; vendor/warehouse/webhook have no include; guard `findAndCountAllDistinct.bug01` |
| BUG-02 | FIXED | Wave 2 | `utils/sessionState.util.ts`: one definition of a live session, read by list, stats, validator, ownSessions |
| ARC-01 | FIXED | Wave 3 | `sessionAdmin.service`, `ssoSession.service`; guard `noControllerTransactions.arc01` |
| DB-01 | FIXED | Wave 2 | migration 0150 (8 indexes, CONCURRENTLY); live `t0150` 3/3 on PostgreSQL 18 |
| DB-02 | FIXED / VERIFIED | Wave 3 | kanban metrics read 5 attributes; dataRetention + gdpr already keyset-paged (D-24); webhook emit bounded by configuration |
| DB-03 | FIXED (webhook) | Wave 2 | `emitEvent` writes deliveries in one `bulkCreate` |
| PERF-01 | NO CHANGE | Wave 3 | both jobs already bounded (purge 1,000/tx, 50,000/run; sweep 200/tx, 5,000/run, SKIP LOCKED) |
| A11-PERF-01 | OPEN — runtime verification | — | needs a seeded large tenant with query logging; the static halves are DB-02/DB-03/PERF-01 |
| A11-DB-03 | FIXED | Wave 3 | 12 of 18 already rethrew; the 6 swallowing catches narrowed; fresh boot proved on PostgreSQL 18 |
| A11-ARCH-01 | FIXED | Wave 3 | 0 unused directives; 1 missing reason fixed; guard `eslintDisableReasons.a11arch01` |
| ARC-02 | FIXED | Wave 2 | `checkMenu.util.js` + its test deleted (A-18 closed); ratchet floor 2 |
| SEC-02 | FIXED (production) | Wave 2 | override `archiver → readdir-glob → minimatch ^11.0.1`; `npm audit --omit=dev` 0; real ZIP proved. deepmerge 4.3.2 does not exist — that half is void |
| PERF-02 | FIXED | Wave 3 | TipTap via `next/dynamic`: 210.3 → 83.0 KB gzip first load; jsPDF already dynamic |
| DEP-01 | FIXED (eslint 10, undici 8 held) | Wave 3 | stripe 23.1.0 (signature verified with the real library), motion 14.9.1; undici held at 7.30.1: 8.12.3 made seven jsdom suites run out of heap (jest.setup.ts installs its Request/Response; BACKLOG D-14) |
| A11-DEP-01 | FIXED | Wave 3 | 65 in-range bumps; held: `@yao-pkg/pkg` (A-325 pin), `typescript-eslint` 8.70.1 (BACKLOG D-12) |
| A11-DEP-02 | FIXED | Wave 3 | moment + moment-timezone removed; Intl proved identical on six boundary instants |
| A11-DB-01 | FIXED (docs) | Wave 3 | sizing rule per topology in docs/BACKEND/11 |
| A11-DB-04 | VERIFIED | Wave 3 | all 63 tenant tables have a tenant_id-leading index; live t0150 asserts it |
| A11-ARCH-02 | NO CHANGE | — | navigation concern, as the audit says; ARC-01 thinned two controllers |
| A11-ARCH-03 | VERIFIED | Wave 3 | tsc6 differential: one divergence class (TS2497 on `import type * as` of `export =`), recorded as BACKLOG W-13 |
| A11-INFRA-01 | DECLINED | — | owner rule 2026-11-02: no GitHub Actions work; E2E stays a local gate (A-19) |

Findings introduced only in the addendum sprint roadmap (A11-DEP-01/02, A11-DB-04,
A11-ARCH-02/03, A11-INFRA-01) are outside the assigned Wave 1 list and were not
implemented here.

Not run in-session: `environmentSchema.p906.test.ts` (4-minute identity test; the
changes are provably identity-preserving), the full-suite `test:coverage` 100% gate
(per-commit related suites run instead), and the production image boot.


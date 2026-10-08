# 12 — Multi-Frontend and Shared Component Architecture

> **Superseded in part by ADR-134 (2026-10-08, plan).** The root `shared/` area, shared UI components and a per-backend frontend adapter described here are **not** the plan any more: shared code lives in `packages/*` (logic and design tokens only; each platform renders its own UI), and one OpenAPI-generated client serves both engines. See [`docs/SHARED/01-ARCHITECTURE.md`](../SHARED/01-ARCHITECTURE.md) § 9. The rest of this document stands until P32-09 rewrites it.

> **Status: Planned (Phase 999 and beyond).** The current frontend is a single Next.js 16 application at `frontend/src/`. The `shared/` root described here does not exist yet. A Go-targeted frontend adapter does not exist. Do not create this directory structure before the Go backend (Phase 999) begins producing stable API endpoints.

Current frontend: [`../ARCHITECTURE/02-FRONTEND-ARCHITECTURE.md`](./02-FRONTEND-ARCHITECTURE.md).
Frontend standards: [`../FRONTEND/00-FRONTEND-STANDARDS.md`](../FRONTEND/00-FRONTEND-STANDARDS.md).
Go backend: [`../BACKEND/12-GO-PORTING-SPECIFICATION.md`](../BACKEND/12-GO-PORTING-SPECIFICATION.md).

---

## 1. Why Multi-Frontend?

The existing frontend (`frontend/src/`) is tightly coupled to the TypeScript backend through two mechanisms:

1. **`src/api/client.ts`**: An axios instance with the Express API's base URL, envelope unwrap logic, and session cookie behaviour.
2. **51 service modules** under `src/api/services/` that encode the exact Express API endpoint paths and response shapes.

When the Go backend is introduced, those 51 service modules need either modification or a parallel set. The multi-frontend architecture answers the question of **where** backend-specific HTTP client code lives and **what** must not change between the two frontend integration targets.

The model is not "two separate frontends". It is one frontend application whose backend-facing client layer is swappable, while the UI layer is shared. A developer building a calibration record list page should not need to know which backend engine is serving it.

---

## 2. Dependency Hierarchy

```
shared/
│  Pure UI components, utilities, types, domain enums
│  No HTTP clients. No environment variables. No session logic.
│  The only imports allowed: React, date-fns, project design tokens.
│
└── frontend/src/ (existing Next.js app)
         │
         ├── src/components/     ← promoted shared UI, today
         ├── src/api/client.ts   ← TS-backend-specific axios instance
         └── src/api/services/   ← 51 TS-backend-specific service modules
                  │
                  ▼
         TypeScript Backend (backend/src/)
                  Express + Sequelize + JWT + session cookie
```

Target architecture (Phase 999):

```
shared/                             ← backend-agnostic
│  components/, utilities/, types/, contracts/
│
├── frontend/src/                   ← TS-backend frontend (existing, adapted)
│        │
│        ├── src/api/client.ts      ← TS backend adapter (unchanged)
│        └── src/api/services/      ← 51 TS service modules (unchanged interface)
│                 │
│                 ▼
│        TypeScript Backend (backend/src/)
│
└── frontend/go-adapter/ (or frontend/src/api/go/)   ← Go-backend adapter (Phase 999)
         │
         ├── client.go.ts           ← Go backend axios instance (different base URL, same envelope)
         └── services/              ← 51 Go-backend service modules
                  │
                  ▼
         Go Backend (backend-go/)
```

The two adapter layers call services with different base URLs and potentially different request shaping (e.g. if the Go backend adds idempotency key headers), but they **must expose the same TypeScript function signatures** to the pages that use them. A page calling `deviceService.list(params)` must not care which backend it is talking to.

---

## 3. The Shared Directory

### 3.1 Location and Status

Target path: `shared/` at the repository root, alongside `frontend/` and `backend/`.

**Does not exist today.** Before Phase 999 begins, the appropriate first step is extracting existing reusable code from `frontend/src/components/` into `shared/`. This is a refactor task, not a new-feature task, and it must be behaviour-neutral.

### 3.2 Directory Structure

```
shared/
├── components/
│   ├── ui/
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   ├── Button.test.tsx
│   │   │   └── index.ts
│   │   ├── Input/
│   │   ├── Badge/
│   │   ├── Dialog/
│   │   ├── Tooltip/
│   │   └── Skeleton/
│   ├── forms/
│   │   ├── FormField/         ← label + input + error message wrapper
│   │   ├── FormSection/       ← grouped form rows with a heading
│   │   └── SubmitButton/      ← loading state + disabled during submit
│   ├── data-display/
│   │   ├── DataTable/         ← sortable, filterable, paginated table
│   │   ├── StatusPill/        ← coloured pill for entity statuses
│   │   ├── MetricCard/        ← dashboard KPI card
│   │   ├── EmptyState/        ← empty list visual + CTA
│   │   └── ErrorState/        ← failed request visual + retry
│   └── feedback/
│       ├── Toast/             ← transient feedback (success / error / info)
│       ├── Alert/             ← inline contextual feedback
│       └── LoadingSpinner/    ← full-page and inline variants
├── utilities/
│   ├── formatters/
│   │   ├── date.ts            ← ISO 8601 → "27 Sep 2026" / "23:47" / relative
│   │   ├── currency.ts        ← number → "IDR 1.500.000" with locale
│   │   └── calibration.ts     ← uncertainty value → "±0.05 mm"; result → label
│   ├── validators/
│   │   ├── uuid.ts            ← is it a valid UUID? (for client-side pre-checks)
│   │   └── calibration.ts     ← out-of-tolerance check before form submit
│   └── calculations/
│       ├── uncertainty.ts     ← combined standard uncertainty, coverage factor
│       └── tolerance.ts       ← pass/fail boundary checks
├── types/
│   ├── device.ts              ← Device, CalibrationRecord, CalibrationResult
│   ├── certificate.ts         ← Certificate, CertificateStatus, CertificateSigner
│   ├── tenant.ts              ← Tenant, TenantSettings, TenantBranding
│   ├── user.ts                ← User, Role, Permission
│   ├── audit.ts               ← AuditLog entry shape
│   ├── pagination.ts          ← Meta, PaginatedResponse<T>
│   └── common.ts              ← BaseEntity (id, created_at, updated_at, is_deleted)
└── contracts/
    ├── envelopes.ts           ← SuccessResponse<T>, ErrorResponse, PaginatedResponse<T>
    ├── enums/
    │   ├── CertificateStatus.ts    ← "draft" | "submitted" | "pending_approval" | "approved" | "signed" | "revoked"
    │   ├── CalibrationResult.ts    ← "pass" | "fail" | "conditional_pass"
    │   ├── WorkOrderStatus.ts      ← "draft" | "open" | "in_progress" | "completed" | "cancelled"
    │   └── TenantStatus.ts         ← "active" | "suspended" | "inactive"
    └── requests/
        ├── pagination.ts           ← PageRequest: { page, limit, sort_by, sort_order }
        └── search.ts               ← SearchRequest: { q, filters }
```

### 3.3 What Is Promoted to `shared/`

The rule for promotion is **used by more than one backend adapter target**. During Phase 999 this means: if a component or type is used by both the TS-backend and Go-backend adapter layers, it lives in `shared/`. If it is used by only one backend target, it stays in that adapter's directory.

In practice, everything in `shared/types/` and `shared/contracts/` is promoted immediately — the type contracts are backend-agnostic by definition. UI components are promoted selectively, starting with the primitive building blocks (`Button`, `DataTable`, `EmptyState`, `ErrorState`).

---

## 4. Boundary Rules

These rules are the architectural constraint. Violations are caught in code review, not enforced by a build tool (yet — a lint rule is planned under Phase 999 tooling).

### 4.1 What `shared/` Must Not Import

| Forbidden import | Why |
|---|---|
| `axios`, `fetch` with hardcoded URLs | API clients are backend-specific |
| `next/navigation`, `next/router` | Framework-specific |
| Zustand stores | State lifecycle is app-level, not shared |
| `process.env.*` | Environment variables are deployment-specific |
| Any `backend/src/` or `backend-go/` code | Backend code never belongs in the frontend |
| JWT / session management | Auth lifecycle is app-level |

A `shared/` component that imports an axios instance has a hidden coupling to whichever backend URL the axios instance points to. When the Go adapter uses it, it silently hits the TS backend. This is the exact failure mode the architecture prevents.

### 4.2 What Backend Adapters Must Not Do

| Forbidden pattern | Why |
|---|---|
| Import from the other backend's adapter | The two adapters are independently replaceable |
| Return backend-specific error objects to the page layer | Pages receive typed `ErrorResponse`; the adapter translates |
| Return raw axios/fetch responses | The adapter unwraps the envelope; pages receive `data` and `meta` |
| Expose the base URL in the adapter's exported interface | The URL is an adapter configuration concern |

### 4.3 What Pages Must Not Do

| Forbidden pattern | Why |
|---|---|
| Import directly from `src/api/client.ts` | Pages use named service functions, not the raw HTTP client |
| Construct request objects from raw JSON | Use the typed request shapes from `shared/contracts/requests/` |
| Render an empty list when a request fails | An empty list is a lie about a compliance figure — documented in `docs/FRONTEND/00-FRONTEND-STANDARDS.md` |
| Hide menu items based on client-side permission arrays | Authorization is server-resolved (see §6 below) |

---

## 5. Backend API Adapter Interface Contract

Both backend adapters must expose identical TypeScript function signatures. The page imports from the adapter — which adapter it resolves to is a deployment concern (environment variable or build flag).

```ts
// shared/contracts/adapter.ts
// This is the interface both backend adapters must satisfy.

export interface IBackendAdapter {
  // Devices
  listDevices(params: PageRequest): Promise<PaginatedResponse<Device>>;
  getDevice(id: string): Promise<Device>;
  createDevice(data: CreateDeviceRequest): Promise<Device>;
  updateDevice(id: string, data: UpdateDeviceRequest): Promise<Device>;
  deleteDevice(id: string): Promise<void>;

  // Calibration Records
  listCalibrationRecords(deviceId: string, params: PageRequest): Promise<PaginatedResponse<CalibrationRecord>>;
  createCalibrationRecord(deviceId: string, data: CreateCalibrationRecordRequest): Promise<CalibrationRecord>;

  // Certificates
  listCertificates(params: PageRequest): Promise<PaginatedResponse<Certificate>>;
  getCertificate(id: string): Promise<Certificate>;
  submitCertificate(id: string): Promise<Certificate>;
  approveCertificate(id: string): Promise<Certificate>;
  signCertificate(id: string, data: SignCertificateRequest): Promise<Certificate>;
  revokeCertificate(id: string, reason: string): Promise<Certificate>;

  // ... one method per backend endpoint, 51 services × average 5 methods = ~255 methods
}
```

The TS-backend adapter implements `IBackendAdapter` by wrapping `src/api/services/*.ts`. The Go-backend adapter implements the same interface by wrapping a parallel `frontend/go-adapter/services/*.ts`. A page component that receives an `IBackendAdapter` instance does not know which backend is behind it.

---

## 6. Current Frontend as the TypeScript Adapter Target

The existing frontend (`frontend/src/`) is today the TypeScript adapter target. Its existing patterns are the reference implementation.

### 6.1 What Already Works as an Adapter Pattern

| Existing pattern | Role in the target architecture |
|---|---|
| `src/api/client.ts` — axios with base URL, auth header, envelope unwrap | The adapter implementation detail (not exported to pages) |
| `src/api/services/*.ts` — 51 named service functions | The adapter's public interface |
| `src/app/dashboard/[domain]/hooks/` — per-domain data fetching | The page layer — must not change regardless of backend |

### 6.2 What Needs Extraction Before the Go Adapter Can Be Added

Shared types and contracts are currently **hand-written in `frontend/src/api/services/*.ts`** and duplicated across files. Before a Go adapter can be added, these need to be extracted to `shared/types/` so both adapters reference the same definitions:

| Currently duplicated in | Target in `shared/` | Priority |
|---|---|---|
| Inline `Device` type in `deviceService.ts` | `shared/types/device.ts` | P1 |
| Inline `CertificateStatus` union in `certificateService.ts` | `shared/contracts/enums/CertificateStatus.ts` | P1 |
| `PaginatedResponse<T>` re-declared in 8 service files | `shared/contracts/envelopes.ts` | P1 |
| `PageRequest` params object rebuilt in every list function | `shared/contracts/requests/pagination.ts` | P2 |

**This extraction is a Phase 999 prerequisite, not a Phase 999 deliverable.** If Phase 9 includes a `packages/contracts` step (P9-22 in the Phase 9 backlog), that is the right time to do it.

---

## 7. Three-State Rule — Every Data Surface

Every list surface in the frontend must support exactly three distinct visual states. This applies to both the TS adapter and any Go adapter:

| State | Trigger | What to render |
|---|---|---|
| **Loading** | Request in flight | `<Skeleton>` rows at the expected row height |
| **Empty** | Request succeeded, `data` is `[]` | `<EmptyState>` with context-appropriate CTA (e.g. "Add your first device") |
| **Failed** | Request returned an error OR network failure | `<ErrorState>` with the error message and a retry action |

**Never render an empty list when a request fails.** An empty list looks like "no data exists" — which is a different message from "something went wrong". In a calibration compliance platform, a list that silently shows empty instead of erroring can cause an auditor to conclude that no calibration records exist. This is documented in `docs/FRONTEND/00-FRONTEND-STANDARDS.md` as a critical rule.

```tsx
// Correct implementation pattern for any list page
function DeviceList() {
  const { data, isLoading, error } = useDevices();

  if (isLoading) return <DataTable.Skeleton rows={10} />;
  if (error)     return <ErrorState message={error.message} onRetry={refetch} />;
  if (!data?.length) return <EmptyState title="No devices" action={<AddDeviceButton />} />;

  return <DataTable rows={data} columns={deviceColumns} />;
}
```

A component that returns `<DataTable rows={[]} />` on error — because `data` defaults to `[]` — has failed the three-state rule.

---

## 8. Authorization — Menu-Driven, Not Component-Driven

Authorization is not a frontend concern. This applies equally to the TS-backend adapter and the Go-backend adapter.

The sidebar and navigation are populated from the server-resolved menu tree returned by `GET /api/v1/menu-groups`. That endpoint resolves the caller's role and per-user overrides server-side and returns only the menu items the caller may access.

**An unauthorized surface is absent from the menu, not hidden.** There is no client-side permission array, no `if (hasPermission('devices:write')) return null`, no `display: none` conditional. A hidden element remains in the DOM, and its route remains reachable by typing the URL. Backend enforcement is the enforcement point.

The Go backend must implement the same `GET /api/v1/menu-groups` endpoint with the same resolution logic. Until it does, a frontend connected to the Go backend will either have no sidebar or a placeholder sidebar — this is a documented precondition for frontend Go-adapter work.

`AccessDeniedModal` handles the residual case: a route reached via stale menu, a permission revoked mid-session, or a bookmarked URL to a now-forbidden surface.

---

## 9. `NEXT_PUBLIC_*` Environment Variables

This is documented in `docs/FRONTEND/00-FRONTEND-STANDARDS.md` and repeated here because it directly affects the adapter model.

**`NEXT_PUBLIC_*` variables are inlined at build time, not at runtime.** A different backend URL means a different build — not a runtime toggle. The TS-backend frontend and the Go-backend frontend **cannot share the same built image** if they point to different API base URLs.

Consequence for the adapter model:
- `NEXT_PUBLIC_API_URL` in the TS adapter build → `https://api.callibrator.com` (TS backend)
- `NEXT_PUBLIC_GO_API_URL` in the Go adapter build → `https://go-api.callibrator.com` (Go backend)

These are **two separate Next.js builds**. During Phase 999 testing, the Go adapter frontend is deployed as a separate service — not as a configuration flag on the existing frontend image.

The long-term target, after full parity is proven, is a single frontend that can be pointed at either backend via build-time configuration.

---

## 10. Review Checklist for Any Shared Component

A component is ready to merge into `shared/` when:

- [ ] No import of `axios`, `fetch`, `next/*`, or any Zustand store
- [ ] No reference to `process.env` or hardcoded URL strings
- [ ] Three-state rule satisfied for any component that displays data
- [ ] Component is exported from its directory's `index.ts`
- [ ] `*.test.tsx` exists and passes with `jest + @testing-library/react`
- [ ] Story or usage example documented in the component directory's `README.md`
- [ ] TypeScript strict — no `any`, no `!` assertions, no `as unknown as X`
- [ ] Storybook / demo renders in isolation without a backend connection

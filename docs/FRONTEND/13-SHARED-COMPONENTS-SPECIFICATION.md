# 13 — Shared Components Specification

> **Superseded in part by ADR-134 (2026-10-08, plan).** The root `shared/` area, shared UI components and a per-backend frontend adapter described here are **not** the plan any more: shared code lives in `packages/*` (logic and design tokens only; each platform renders its own UI), and one OpenAPI-generated client serves both engines. See [`docs/SHARED/01-ARCHITECTURE.md`](../SHARED/01-ARCHITECTURE.md) § 9. The rest of this document stands until P32-09 rewrites it.

---

## 1. Overview & Categorization

Shared components in Callibrator live in the root-level shared directory (`shared/`) and serve as the single source of truth for presentation, client-side domain rules, and API contracts across all frontend surfaces.

Components are categorized into three core buckets:

```text
shared/
├── components/     # UI Presentation Primitives & Complex Controls
├── utilities/      # Pure Functions, Calculations & Client Validation
└── contracts/      # DTO Envelopes, API Schemas & Domain Enums
```

---

## 2. Component Categories & Examples

### 2.1 Shared UI Components (`shared/components/`)
- **Buttons & Input Primitives**: `Button`, `IconButton`, `TextInput`, `Select`, `Checkbox`, `Switch`.
- **Form Controls & Layout**: `FormGroup`, `FormLabel`, `FormFieldError`, `FormSection`.
- **Dialogs & Modals**: `Modal`, `ConfirmDialog`, `Drawer`, `Popover`.
- **Data Display**: `DataTable`, `PaginationBar`, `Badge`, `StatusPill`, `MetricCard`.
- **Navigation & Layout**: `SidebarNav`, `Breadcrumb`, `TopHeader`, `TabGroup`.
- **Feedback & States**: `LoadingSpinner`, `ToastAlert`, `EmptyState`, `ErrorState`.

### 2.2 Shared Frontend Logic (`shared/utilities/`)
- **Formatters**: Date/time formatting (ISO to locale format), currency formatting, serial number display formatting.
- **Calibration Utilities**: Tolerance calculation (ISO 17025 rules), measurement error calculations, uncertainty bounds evaluation.
- **Client Validation**: Pure validation functions for device serials, hospital barcodes, serial number formats, and form field sanity rules.
- **Presentation Logic**: State-independent UI rules (e.g. mapping `CertificateStatus` to color tokens and display labels).

### 2.3 Shared Contracts & Types (`shared/contracts/` & `shared/types/`)
- **API Response Envelope**:
  ```typescript
  export interface APIResponseEnvelope<T> {
    success: boolean;
    data: T;
    meta?: PaginationMeta;
    error?: APIErrorDetails;
  }
  ```
- **Pagination Meta**:
  ```typescript
  export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }
  ```
- **Domain Models**: `DeviceDTO`, `CalibrationRecordDTO`, `CertificateDTO`, `TenantDTO`, `UserDTO`.
- **Domain Enums**: `DeviceStatus`, `CertificateStatus`, `WorkOrderStatus`, `AuditAction`.

---

## 3. Mandatory Shared Component Dependency Rules

```text
       ┌───────────────────────────────┐
       │   Shared Components (`shared`)│
       └───────────────▲───────────────┘
                       │ (imported by)
       ┌───────────────┴───────────────┐
       │   Frontend Views & Pages      │
       └───────────────▲───────────────┘
                       │ (uses)
       ┌───────────────┴───────────────┐
       │   Backend-Specific Adapters   │
       └───────────────────────────────┘
```

### 3.1 Strict Prohibition List
Shared components **MUST NOT**:
1. Import Node.js server modules, Express objects, or Sequelize models.
2. Import Go source code or Go-specific structures.
3. Call `fetch` or HTTP clients directly with hardcoded API URLs.
4. Contain backend authentication credentials or session state management.
5. Depend on environment deployment variables (`process.env.BACKEND_TYPE`).

### 3.2 Adapter Isolation Responsibilities
Backend API adapters **MUST**:
1. Isolate all backend HTTP transport differences.
2. Normalize response envelopes into `APIResponseEnvelope<T>`.
3. Provide a stable API client interface for all shared UI views.

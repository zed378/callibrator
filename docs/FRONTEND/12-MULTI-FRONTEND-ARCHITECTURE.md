# 12 — Multi-Frontend Integration Architecture

> **Superseded in part by ADR-134 (2026-10-08, plan).** The root `shared/` area, shared UI components and a per-backend frontend adapter described here are **not** the plan any more: shared code lives in `packages/*` (logic and design tokens only; each platform renders its own UI), and one OpenAPI-generated client serves both engines. See [`docs/SHARED/01-ARCHITECTURE.md`](../SHARED/01-ARCHITECTURE.md) § 9. The rest of this document stands until P32-09 rewrites it.

---

## 1. Context & Motivation

As Callibrator transitions toward a **dual-backend architecture** (TypeScript backend existing, Go backend future), the frontend architecture is structured to support dual integration targets without code duplication in presentation layers.

```text
                        PRESENTATIONAL UI LAYER
           (shared/components/, shared/utilities/, pages/views)
                                   |
               +-------------------+-------------------+
               |                                       |
               v                                       v
    TypeScript API Client Adapter            Go API Client Adapter
   (frontend/src/services/api.ts)          (frontend/src/services/api-go.ts)
               |                                       |
               v                                       v
    TypeScript Backend Engine               Go Backend Engine
        (backend/src/)                         (backend-go/)
```

---

## 2. Integration Target Separation

### 2.1 Frontend TypeScript Target
- **Purpose**: Integrates with the existing TypeScript Express backend (`backend/src/`).
- **Adapter Location**: `frontend/src/services/api.ts` (and domain services under `frontend/src/services/`).
- **Features**: Translates Express session cookies, Bearer tokens, legacy query param quirks, and Express error response formats into standard frontend DTOs.

### 2.2 Frontend Go Target
- **Purpose**: Integrates with the future Go backend engine (`backend-go/`).
- **Adapter Location**: Target `frontend/src/services/api-go.ts` (or `frontend/go/`).
- **Features**: Optimized for high-throughput Go endpoints, lightweight JSON handling, and strict REST contract matching.

---

## 3. Decoupling Rules & Interface Abstraction

1. **Unified Interface Contract**: Both API client adapters implement a shared interface contract defined in `shared/contracts/`:
   ```typescript
   export interface ICalibrationAPIClient {
     getDevices(params: DeviceFilterParams): Promise<PaginatedResponse<DeviceDTO>>;
     getDeviceById(id: string): Promise<DeviceDTO>;
     createDevice(payload: CreateDeviceDTO): Promise<DeviceDTO>;
     // ...
   }
   ```
2. **Adapter Isolation**: UI components (views, dashboards, forms) MUST interact exclusively with the `ICalibrationAPIClient` abstraction, never referencing backend-specific URLs or HTTP implementation quirks directly.
3. **Zero Backend Leakage**: Shared UI controls must not check `if (backend === 'go')` or `if (backend === 'ts')`. Backend differences are completely resolved at the adapter boundary.

# 15 — Go Coding & Architecture Standards

> **Target standard for `backend-go/` (Phase 999).** No Go source files exist in this repository today. These standards apply from the first line of Go code written in Phase 999. They do not apply to the existing TypeScript backend (`backend/src/`) and do not change any TypeScript rules.

Go porting specification: [`../BACKEND/12-GO-PORTING-SPECIFICATION.md`](../BACKEND/12-GO-PORTING-SPECIFICATION.md).
Dual-backend architecture: [`../ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md`](../ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md).

The TypeScript equivalent of this document is [`04-TYPESCRIPT-STANDARDS.md`](./04-TYPESCRIPT-STANDARDS.md). Read that first for the platform conventions this document mirrors.

---

## 1. The Compiler and Toolchain

Go version: **1.23** (minimum; use the latest stable patch). Declared in `backend-go/go.mod`.

```go
// backend-go/go.mod
module github.com/callibrator/backend-go

go 1.23
```

### 1.1 Formatting

**`gofmt` and `goimports` are non-negotiable.** Code that `gofmt` would change is not merged. Do not configure editors to differ from `gofmt`'s output.

`goimports` manages import grouping:
```go
import (
    // standard library
    "context"
    "fmt"
    "net/http"

    // third-party
    "github.com/jackc/pgx/v5"
    "github.com/redis/go-redis/v9"

    // internal
    "github.com/callibrator/backend-go/internal/domain/device"
    "github.com/callibrator/backend-go/pkg/tenant"
)
```

Three groups, in order: stdlib, third-party, internal. A blank line between each group. `goimports` enforces this automatically.

### 1.2 Linting

`golangci-lint` with the following linters enabled. Treat warnings as errors — a linting warning that CI allows is a rule nobody obeys.

| Linter | What it catches here |
|---|---|
| `errcheck` | Unchecked error returns — the most common Go bug class |
| `govet` | Suspicious constructs the compiler misses (`printf` format strings, composite literals without field names) |
| `staticcheck` | Deprecated API calls, ineffective assignments, incorrect uses of `sync` types |
| `gosec` | SQL injection patterns, hardcoded credentials, `math/rand` where `crypto/rand` is needed |
| `revive` | Exported symbol naming, blank identifier misuse, defer in loop |
| `exhaustive` | Exhaustive `switch` statements on package-defined types — equivalent to TS `switch-exhaustiveness-check` |
| `wrapcheck` | Errors from external packages must be wrapped with `%w` so `errors.Is` works |
| `noctx` | HTTP requests that bypass `context.Context` propagation |
| `sqlclosecheck` | Unclosed `sql.Rows` — silent resource leaks in list queries |

Configuration lives at `backend-go/.golangci.yml`.

The linter equivalent of `@typescript-eslint/no-explicit-any` in Go is `govet`'s `unsafeptr` plus `gosec`'s `G103`. There is no Go equivalent of TypeScript `any`, but `interface{}` / `any` should not appear in domain types — use concrete types.

### 1.3 Test Runner

`go test ./...` from `backend-go/` root. Coverage gate: same 100% function coverage requirement as the TypeScript backend, enforced on non-generated code.

```bash
go test -race -coverprofile=coverage.out ./...
go tool cover -func=coverage.out | grep "total:"
```

`-race` is mandatory in CI. Race conditions in Go HTTP servers are silent in normal runs and catastrophic in production.

---

## 2. Directory Structure and Package Responsibilities

```
backend-go/
├── cmd/
│   └── server/
│       └── main.go              # Composition root — wires dependencies, starts listener
├── internal/
│   ├── domain/                  # Business entities, value objects, domain errors, repository interfaces
│   │   ├── device/
│   │   │   ├── device.go        # Device struct, DeviceStatus type, domain methods
│   │   │   └── repository.go   # DeviceRepository interface (defined here, implemented in infra/)
│   │   ├── calibration/
│   │   │   ├── record.go        # CalibrationRecord, CalibrationResult type
│   │   │   └── repository.go
│   │   ├── certificate/
│   │   │   ├── certificate.go   # Certificate, CertificateStatus, transition table
│   │   │   └── repository.go
│   │   ├── tenant/
│   │   ├── user/
│   │   ├── audit/
│   │   │   └── audit.go         # AuditLog struct; every service writes this
│   │   └── errors.go            # Sentinel errors: ErrNotFound, ErrTenantMismatch, ErrInvalidTransition, ErrForbidden
│   ├── application/             # Use cases and service implementations; DTOs
│   │   ├── device/
│   │   │   ├── service.go       # DeviceService: GetByID, List, Create, Update, SoftDelete
│   │   │   └── dto.go           # CreateDeviceRequest, UpdateDeviceRequest, DeviceResponse
│   │   ├── calibration/
│   │   ├── certificate/
│   │   └── auth/
│   ├── infrastructure/          # External system implementations
│   │   ├── persistence/
│   │   │   ├── db.go            # pgx connection pool; exposes *pgxpool.Pool
│   │   │   ├── device_repo.go   # DeviceRepository implementation — SQL + tenant predicate
│   │   │   ├── session_repo.go  # SessionRepository — NOTE: sessions table has snake_case columns
│   │   │   └── tx.go            # Transaction helper: Begin, Commit, Rollback, RunInTx
│   │   ├── cache/
│   │   │   └── redis.go         # go-redis client; key helpers that include tenant_id
│   │   ├── queue/
│   │   │   └── rabbitmq.go      # amqp091 producer + consumer; per-message tenant context
│   │   └── storage/
│   │       ├── local.go
│   │       ├── s3.go
│   │       └── nfs.go
│   └── transport/
│       └── http/
│           ├── handler/
│           │   ├── device.go    # HTTP handlers: List, Get, Create, Update, Delete
│           │   └── health.go    # GET /health — returns 503 if db.Ping fails
│           ├── middleware/
│           │   ├── auth.go      # JWT verify, load user + tenant, set context
│           │   ├── tenant.go    # Inject tenant into context.Context
│           │   ├── rbac.go      # dynamicAccess equivalent: resource + action permission gate
│           │   ├── ratelimit.go # Redis-backed window limiter
│           │   ├── requestid.go # X-Request-Id generation (crypto/rand UUID)
│           │   ├── cors.go      # CORS with explicit allowlist; no wildcard with credentials
│           │   ├── recover.go   # Panic → 500; log full stack trace, return sanitised message
│           │   └── audit.go     # Audit log writer middleware (some routes use middleware; others use service)
│           └── router/
│               └── router.go   # Route registration; same paths as TS backend
├── pkg/
│   ├── tenant/
│   │   ├── context.go           # IntoContext, FromContext, NO_TENANT_UUID
│   │   └── bypass.go            # SystemContext, SuperAdminContext (with greppable names)
│   ├── apperr/
│   │   ├── apperr.go            # AppError{Status int, Message string}; domain → HTTP table
│   │   └── codes.go             # Error code constants: "TENANT_MISMATCH", "INVALID_STATE" etc.
│   ├── response/
│   │   └── response.go          # Success(), Paginated(), Error() — must match TS envelope exactly
│   ├── logger/
│   │   └── logger.go            # slog-based; always includes requestId + tenantId fields
│   └── validator/
│       └── validator.go         # Struct-tag validation; returns []FieldError for 400 detail
├── migrations/
│   └── *.sql                    # Same schema; compatible migration format
├── tests/
│   ├── integration/             # Live PostgreSQL tests
│   └── parity/                  # Cross-backend contract diff tests
├── .golangci.yml
├── go.mod
└── go.sum
```

### Package Responsibility Rules

| Package | May import | Must not import |
|---|---|---|
| `internal/domain/` | `pkg/` only | `internal/infrastructure/`, `internal/transport/`, `net/http` |
| `internal/application/` | `internal/domain/`, `pkg/` | `internal/infrastructure/`, `net/http` |
| `internal/infrastructure/` | `internal/domain/`, `pkg/`, third-party drivers | `internal/transport/`, `net/http` |
| `internal/transport/` | All internal packages | Nothing from the outside of `internal/` except through interfaces |
| `pkg/` | stdlib, carefully selected third-party | `internal/` (anything) |

`internal/domain/` must have **zero non-stdlib dependencies**. A domain that imports `pgx` has leaked infrastructure into business logic. `github.com/google/uuid` is the only acceptable exception, and only for entity ID generation.

---

## 3. Context Propagation

`ctx context.Context` is the **first parameter** of every function that performs I/O. This is not a convention — it is the only mechanism Go provides for cancellation, deadline propagation, and value passing across the call stack.

### 3.1 What Goes Into Context

```go
// Middleware injects; services and repos read. Nothing else puts values in context.
// Values:
//   tenant.Key   → string (tenantId or NO_TENANT_UUID)
//   requestid.Key → string (X-Request-Id UUID)
//   user.Key     → *domain.User (post-auth only)
```

Do not add values to context ad-hoc. Define a typed key in a `pkg/` package and export accessor functions. Untyped string keys collide across packages.

### 3.2 Never Store Context in a Struct

```go
// WRONG — hides the context; prevents cancellation propagation
type DeviceService struct {
    ctx context.Context
    db  *pgxpool.Pool
}

// CORRECT — pass ctx explicitly to each method
type DeviceService struct {
    db *pgxpool.Pool
}
func (s *DeviceService) GetByID(ctx context.Context, id string) (*domain.Device, error) { ... }
```

A context stored in a struct is never cancelled when the request is done. Goroutines spawned from it will leak.

### 3.3 Goroutine Spawning

If a handler spawns a background goroutine (e.g. to send a notification), it must not use the request context — which is cancelled when the request completes:

```go
// WRONG — notification goroutine cancelled immediately when response is sent
go sendNotification(ctx, ...)

// CORRECT — detach from request context, bring in only the values needed
notifCtx := context.WithValue(context.Background(), tenant.Key, tenant.FromContext(ctx))
go sendNotification(notifCtx, ...)
```

---

## 4. Error Handling

### 4.1 Wrap Every Error With Context

```go
device, err := r.deviceRepo.FindByID(ctx, id)
if err != nil {
    return nil, fmt.Errorf("DeviceService.GetByID: %w", err)
}
```

Every wrapping must include the operation name so a log trace is readable without a debugger. The format is `PackageName.FunctionName: %w`.

Never:
```go
return nil, err           // loses call-stack context
return nil, errors.New("not found") // creates a new error, breaks errors.Is chain
```

### 4.2 Sentinel Domain Errors

```go
// internal/domain/errors.go
var (
    ErrNotFound          = errors.New("not found")
    ErrTenantMismatch    = errors.New("tenant mismatch")
    ErrInvalidTransition = errors.New("invalid state transition")
    ErrForbidden         = errors.New("forbidden")
    ErrConflict          = errors.New("conflict")
)
```

Usage in a repository:
```go
if errors.Is(err, pgx.ErrNoRows) {
    return nil, fmt.Errorf("device %s: %w", id, domain.ErrNotFound)
}
```

Usage in transport (the HTTP status translation table):
```go
// pkg/apperr/apperr.go
func HTTPStatus(err error) int {
    switch {
    case errors.Is(err, domain.ErrNotFound):       return http.StatusNotFound    // 404
    case errors.Is(err, domain.ErrTenantMismatch): return http.StatusNotFound    // 404 (not 403!)
    case errors.Is(err, domain.ErrForbidden):      return http.StatusForbidden   // 403
    case errors.Is(err, domain.ErrInvalidTransition): return http.StatusConflict // 409
    case errors.Is(err, domain.ErrConflict):       return http.StatusConflict    // 409
    default:                                        return http.StatusInternalServerError // 500
    }
}
```

**`ErrTenantMismatch` maps to 404, not 403.** Cross-tenant access returns 404 — same as the TS backend. A 403 confirms the resource exists, which turns ID enumeration into a tenant-membership oracle. This is not a bug — it is a deliberate security decision, documented in `docs/BACKEND/05-TENANT-SCOPING.md`.

### 4.3 Panic Recovery

HTTP handlers must be wrapped in a recovery middleware:

```go
// internal/transport/http/middleware/recover.go
func Recover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rv := recover(); rv != nil {
                logger.Error("panic recovered",
                    "requestId", requestid.FromContext(r.Context()),
                    "tenantId",  tenant.FromContext(r.Context()),
                    "panic",     rv,
                    "stack",     string(debug.Stack()),
                )
                response.Error(w, http.StatusInternalServerError, "Internal server error")
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

The stack trace goes to the log. The client receives `"Internal server error"` — no file paths, no goroutine dumps. This mirrors `errorHandlers.middleware.js` in the TS backend.

---

## 5. Database Access

### 5.1 Driver and Pool

`pgx/v5` with `pgxpool`. Do not use `database/sql` — `pgx` native mode is more type-safe and supports PostgreSQL-specific types (`pgtype.UUID`, `pgtype.Numeric`, `pgtype.JSONB`) without conversion overhead.

```go
// internal/infrastructure/persistence/db.go
func NewPool(ctx context.Context, connString string) (*pgxpool.Pool, error) {
    cfg, err := pgxpool.ParseConfig(connString)
    if err != nil {
        return nil, fmt.Errorf("parse db config: %w", err)
    }
    cfg.MaxConns = 20        // matches DB_POOL_MAX production default
    cfg.MinConns = 2         // matches DB_POOL_MIN default
    cfg.MaxConnLifetime = 30 * time.Minute
    cfg.MaxConnIdleTime = 10 * time.Second // matches DB_POOL_IDLE_TIMEOUT

    pool, err := pgxpool.NewWithConfig(ctx, cfg)
    if err != nil {
        return nil, fmt.Errorf("create pool: %w", err)
    }
    if err := pool.Ping(ctx); err != nil {
        return nil, fmt.Errorf("ping db: %w", err)
    }
    return pool, nil
}
```

### 5.2 Tenant Predicate — The Cardinal Rule

Every `SELECT`, `UPDATE`, and `DELETE` must include `AND tenant_id = $N`. This is not optional for "sensitive" data — it is mandatory for every table that has a `tenant_id` column.

There is no ORM hook safety net. If the predicate is omitted, the query returns rows belonging to any tenant. The linter does not catch missing SQL predicates. **Code review is the only safety net**, and the two-tenant test is the only automated check.

```go
// CORRECT
`SELECT id, name FROM calibration_devices WHERE id = $1 AND tenant_id = $2 AND is_deleted = false`

// WRONG — no tenant predicate
`SELECT id, name FROM calibration_devices WHERE id = $1 AND is_deleted = false`
```

### 5.3 Transactions

Transactions open in the **application service layer**, never in a handler. The `RunInTx` helper ensures the transaction is always committed or rolled back:

```go
// internal/infrastructure/persistence/tx.go
func (db *DB) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
    tx, err := db.pool.Begin(ctx)
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback(ctx) // no-op if Commit succeeds

    if err := fn(ctx, tx); err != nil {
        return err
    }
    return tx.Commit(ctx)
}
```

Usage in a service:
```go
func (s *DeviceService) Update(ctx context.Context, id string, req dto.UpdateDeviceRequest) (*dto.DeviceResponse, error) {
    return nil, s.db.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
        // 1. Update device
        if _, err := tx.Exec(ctx, `UPDATE calibration_devices SET name=$1 WHERE id=$2 AND tenant_id=$3`,
            req.Name, id, tenant.FromContext(ctx)); err != nil {
            return fmt.Errorf("update device: %w", err)
        }
        // 2. Write audit row INSIDE the same transaction
        if err := s.auditRepo.WriteInTx(ctx, tx, audit.Entry{...}); err != nil {
            return fmt.Errorf("write audit: %w", err)
        }
        return nil
    })
}
```

### 5.4 `DECIMAL` and `COUNT` Types

`pgx` returns `NUMERIC` / `DECIMAL` as `pgtype.Numeric`, not as a Go `float64`. Scan it explicitly:

```go
var uncertainty pgtype.Numeric
err := row.Scan(&uncertainty)
// Convert to float64 for use
val, _ := uncertainty.Float64Value()
```

The TS backend documents this trap: `node-postgres` returns DECIMAL as strings, which caused silent `"90.00" > "1000.00" === true` comparisons (documented in `docs/BACKEND/00-BACKEND-STANDARDS.md` §3). Go avoids the string problem but introduces the `pgtype.Numeric` scan requirement. Document the chosen serialization (number or string) in the decimal parity ADR.

### 5.5 `sessions` Table — snake_case Columns

`sessions` is the one table in this database that uses snake_case column names in the schema (`tenant_id`, `user_id`, `token_hash`), while all other tables use underscored versions of their camelCase Sequelize attribute names. This is a known historical anomaly that broke the TypeScript nightly retention purge.

Go struct tags for `sessions`:
```go
type Session struct {
    ID        string    `db:"id"`
    TenantID  string    `db:"tenant_id"`   // snake_case — NOT "tenantId"
    UserID    string    `db:"user_id"`     // snake_case — NOT "userId"
    TokenHash string    `db:"token_hash"`  // snake_case — NOT "tokenHash"
    ExpiresAt time.Time `db:"expires_at"`
    CreatedAt time.Time `db:"created_at"`
}
```

Do not use `db:"tenantId"` for this table. The column does not exist.

---

## 6. Dependency Injection

### 6.1 Consumer-Defined Interfaces

Interfaces are defined in the package that **consumes** them, not where they are implemented. This is Go idiom, not a platform preference.

```go
// internal/application/device/service.go
// The service defines the interface it needs — the infra package satisfies it.
type deviceRepository interface {
    FindByID(ctx context.Context, id string) (*domain.Device, error)
    List(ctx context.Context, params ListParams) ([]*domain.Device, int, error)
    Create(ctx context.Context, device *domain.Device) error
    Update(ctx context.Context, device *domain.Device) error
    SoftDelete(ctx context.Context, id string) error
}
```

The infrastructure package `device_repo.go` implements this interface implicitly (Go structural typing). No `implements` keyword is needed or available.

### 6.2 No Global Mutable State

```go
// WRONG — global mutable variable
var defaultDB *pgxpool.Pool

// CORRECT — inject via constructor
type DeviceService struct {
    db   deviceRepository
    log  *slog.Logger
}

func NewDeviceService(db deviceRepository, log *slog.Logger) *DeviceService {
    return &DeviceService{db: db, log: log}
}
```

Sentinel errors (`var ErrNotFound = errors.New("not found")`) and compile-time constants are the only allowed package-level globals.

---

## 7. Structured Logging

```go
// pkg/logger/logger.go
func New() *slog.Logger {
    return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
}
```

**Every log call must include `requestId` and `tenantId`**:

```go
s.log.ErrorContext(ctx, "device update failed",
    slog.String("requestId", requestid.FromContext(ctx)),
    slog.String("tenantId",  tenant.FromContext(ctx)),
    slog.String("deviceId",  id),
    slog.String("error",     err.Error()),
)
```

This matches the TS backend's winston format: every structured log line includes `requestId` and `tenantId` as top-level fields so log aggregators can correlate by tenant or by request.

**Never log secrets.** The same fields excluded from API responses (`password`, `mfaSecret`, `privateKey`, `iotDeviceToken`) must not appear in logs. A log aggregator query is not subject to per-field access control.

Production log level is `INFO`. `DEBUG` entries are compiled in but suppressed. The level is configurable via `LOG_LEVEL` env var.

---

## 8. Naming Conventions

| Category | Convention | Examples |
|---|---|---|
| Package names | Short, lowercase, singular | `tenant`, `device`, `audit`, `auth` |
| Exported types | `PascalCase` | `DeviceService`, `CalibrationRecord`, `AppError` |
| Unexported types | `camelCase` | `deviceRepo`, `calibrationSvc` |
| Interface names | Describe capability | `deviceRepository`, `auditWriter`, `tokenVerifier` |
| Error variables | `Err` prefix | `ErrNotFound`, `ErrInvalidTransition` |
| Context key types | Unexported struct | `type contextKey struct{ name string }` |
| Test functions | `Test<Func>_<scenario>` | `TestDeviceService_GetByID_CrossTenantReturns404` |

Do not use `util`, `common`, or `helpers` as package names. A function named `util.FormatDate` cannot be understood without reading it. A function named `timeformat.ISO8601` is self-documenting.

---

## 9. Security Rules

### 9.1 Secrets Never Enter Response Structs

```go
// CORRECT — excluded with json:"-"
type UserResponse struct {
    ID       string `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email"`
    Password string `json:"-"`    // never serialized
    MFASecret string `json:"-"`   // never serialized
}
```

The TS backend enforces this through Sequelize `defaultScope`. Go enforces it through `json:"-"` struct tags. A field missing the tag and not listed in the `defaultScope` equivalent will be serialized. Test this: assert that the response from `GET /api/v1/users/:id` does not contain a `password` or `mfa_secret` key.

### 9.2 SQL Injection

`pgx` parameterized queries prevent SQL injection when `$1`/`$2` placeholders are used. String interpolation in SQL is never acceptable:

```go
// WRONG — SQL injection
query := fmt.Sprintf("SELECT * FROM devices WHERE name = '%s'", name)

// CORRECT
row := db.QueryRow(ctx, "SELECT * FROM devices WHERE name = $1 AND tenant_id = $2", name, tenantID)
```

`gosec` catches the interpolation pattern. If `gosec` is disabled on a line, it is a PR blocker.

### 9.3 Random Numbers

Use `crypto/rand` for anything security-sensitive (token generation, session IDs, CSRF tokens). `math/rand` is for simulation and tests only.

```go
// CORRECT
b := make([]byte, 32)
if _, err := io.ReadFull(rand.Reader, b); err != nil {
    return "", err
}
token := base64.URLEncoding.EncodeToString(b)
```

---

## 10. Before a PR

- [ ] `gofmt -l .` returns no output
- [ ] `golangci-lint run ./...` returns no errors
- [ ] `go test -race ./...` passes
- [ ] Every new `SELECT`/`UPDATE`/`DELETE` has `AND tenant_id = $N`
- [ ] Every new `:id` route has a two-tenant test asserting **404**, not 200 or 403
- [ ] Every mutation writes an audit row in the same transaction
- [ ] Secrets excluded from response structs with `json:"-"`
- [ ] No `fmt.Sprintf` in SQL — only parameterized placeholders
- [ ] `context.Context` is the first param of every I/O function
- [ ] Errors wrapped with `fmt.Errorf("...: %w", err)`
- [ ] No `panic` in normal operational flow
- [ ] Log lines include `requestId` and `tenantId`
- [ ] Sentinel error mapped to correct HTTP status (ErrNotFound → 404; ErrInvalidTransition → 409; ErrTenantMismatch → 404)

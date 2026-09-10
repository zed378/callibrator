/**
 * SVG Illustration Generator
 *
 * Generates all architectural diagrams as SVG files using Mermaid.js.
 * Run with: node scripts/generate-illustrations.js
 *
 * Output: backend/docs/illustrations/
 */

const fs = require("fs");
const path = require("path");

// ============================================================
// DIAGRAM DEFINITIONS (Mermaid syntax)
// ============================================================

const DIAGRAMS = [
  {
    id: "01-system-architecture",
    title: "System Architecture",
    mermaid: `
graph TB
    subgraph Clients["Client Applications"]
        Web["Web App"]
        Mobile["Mobile App"]
        Admin["Admin Panel"]
    end

    subgraph CDN["CDN / Proxy"]
        Nginx["Nginx Reverse Proxy"]
    end

    subgraph Backend["Backend API (Express.js 5.x)"]
        Router["API Router"]
        Middleware["Middleware Chain"]
        Controllers["Controllers"]
        Routes["Route Handlers"]
    end

    subgraph Services["Business Logic"]
        AuthService["Auth Service"]
        TenantService["Tenant Service"]
        UserService["User Service"]
        RoleService["Role Service"]
        CalibrationService["Calibration Service"]
        StockService["Stock Service"]
        WarehouseService["Warehouse Service"]
        KanbanService["Kanban Service"]
        NotificationService["Notification Service"]
        EmailService["Email Service"]
        BackupService["Backup Service"]
    end

    subgraph Realtime["Realtime Layer"]
        SocketIO["Socket.IO Gateway"]
    end

    subgraph External["External Services"]
        RabbitMQ["RabbitMQ (AMQP)"]
        SMTP["SMTP Server"]
    end

    subgraph Data["Data Layer"]
        PostgreSQL[(PostgreSQL 14+)]
        Redis[(Redis Cache)]
    end

    Web --> Nginx
    Mobile --> Nginx
    Admin --> Nginx
    Nginx --> Router
    Router --> Middleware
    Middleware --> Controllers
    Controllers --> Routes
    Controllers --> AuthService
    Controllers --> TenantService
    Controllers --> UserService
    Controllers --> RoleService
    Controllers --> CalibrationService
    Controllers --> StockService
    Controllers --> WarehouseService
    Controllers --> KanbanService
    AuthService --> Redis
    AuthService --> RabbitMQ
    EmailService --> RabbitMQ
    EmailService --> SMTP
    AuthService --> PostgreSQL
    TenantService --> PostgreSQL
    UserService --> PostgreSQL
    RoleService --> PostgreSQL
    CalibrationService --> PostgreSQL
    StockService --> PostgreSQL
    WarehouseService --> PostgreSQL
    KanbanService --> PostgreSQL
    KanbanService --> NotificationService
    KanbanService --> SocketIO
    NotificationService --> SocketIO
    NotificationService --> PostgreSQL
    SocketIO --> Web
    BackupService --> PostgreSQL
    Middleware --> Redis
    `,
  },
  {
    id: "02-authentication-flow",
    title: "Authentication Flow",
    mermaid: `
sequenceDiagram
    participant C as Client
    participant A as Auth API
    participant S as Auth Service
    participant DB as PostgreSQL
    participant R as Redis
    participant Q as RabbitMQ

    Note over C,DB: Registration Flow
    C->>A: POST /api/v1/auth/register
    A->>S: registerUser(data)
    S->>DB: Check email/username uniqueness
    S->>DB: Create user (hashed password)
    S->>R: Cache user data (24h TTL)
    S->>Q: Queue activation email
    S-->>A: 201 Created
    A-->>C: { user, message }

    Note over C,DB: Login Flow
    C->>A: POST /api/v1/auth/login
    A->>S: loginUser(credentials)
    S->>R: Check rate limit
    S->>DB: Find user by username/email
    S->>S: Verify password (bcrypt)
    S->>S: Generate JWT access token (15min)
    S->>S: Generate refresh token
    S->>S: Hash refresh token
    S->>DB: Create session record
    S->>R: Cache session data
    S-->>A: { accessToken, refreshToken, session }
    A-->>C: { token, session, data }

    Note over C,DB: Token Refresh
    C->>A: POST /api/v1/auth/refresh
    A->>S: refreshToken(token)
    S->>DB: Find session by refresh token hash
    S->>S: Verify not revoked/expired
    S->>S: Revoke old refresh token
    S->>S: Generate new token pair
    S->>DB: Update session
    S-->>A: { newAccessToken, newRefreshToken }
    A-->>C: { token, session }

    Note over C,DB: Logout
    C->>A: POST /api/v1/auth/logout
    A->>S: logoutSession(sessionId)
    S->>DB: Mark session as revoked
    S->>R: Delete session cache
    S-->>A: 200 OK
    A-->>C: { message: "Logged out" }
    `,
  },
  {
    id: "03-rbac-abac",
    title: "RBAC & ABAC Authorization",
    mermaid: `
graph TB
    subgraph Layer1["Authorization Layers"]
        Auth["JWT Authentication"]
        RBAC["RBAC - Role Based"]
        Dynamic["Dynamic RBAC - Permission Matrix"]
        ABAC["ABAC - Attribute Based"]
    end

    subgraph RBACModels["RBAC Models"]
        Role["Role (Role model)"]
        MenuGroup["MenuGroup (Navigation)"]
        RoleMenuPerm["RoleMenuPermission (Read/Write)"]
        Permission["Permission (Granular)"]
        UserPerm["UserPermission (Individual)"]
    end

    subgraph AccessTypes["Access Types"]
        Global["Global: user:create"]
        Self["Self: user:self:update"]
        Tenant["Tenant: user:tenant:create"]
    end

    subgraph DataIsolation["Data Isolation"]
        TenantId["tenantId (Foreign Key)"]
        JWT["tenantId from JWT"]
        Middleware["tenantContext middleware"]
        Query["Auto-scoped queries"]
    end

    Auth --> RBAC
    RBAC --> Dynamic
    Dynamic --> ABAC

    Role --> MenuGroup
    MenuGroup --> RoleMenuPerm
    RoleMenuPerm --> Permission
    Role -.-> Permission
    UserPerm --> Permission

    Global -.-> RoleMenuPerm
    Self -.-> RoleMenuPerm
    Tenant -.-> RoleMenuPerm

    JWT --> Middleware
    Middleware --> Query
    TenantId --> Query
    ABAC --> DataIsolation
    `,
  },
  {
    id: "04-database-schema",
    title: "Database Schema (ER Diagram)",
    mermaid: `
erDiagram
    TENANTS ||--o{ USERS : has
    TENANTS ||--o{ WAREHOUSES : has
    TENANTS ||--o{ TENANT_BACKUPS : has
    TENANTS ||--o{ TENANT_SETTINGS : has
    TENANTS {
        uuid id PK
        string name
        string subdomain
        string plan
        string status
        object settings
    }

    USERS ||--o{ SESSIONS : creates
    USERS ||--o{ USER_PERMISSIONS : has
    USERS }o--|| ROLES : belongs
    USERS }o--|| TENANTS : belongs
    USERS {
        uuid id PK
        uuid tenantId FK
        string username
        string email
        uuid roleId FK
        string status
    }

    ROLES ||--o{ ROLE_MENU_PERMISSIONS : has
    ROLES ||--o{ USER_PERMISSIONS : defines
    ROLES {
        uuid id PK
        uuid tenantId FK
        string name
        int level
        string status
    }

    ROLE_MENU_PERMISSIONS }o--|| ROLES : links
    ROLE_MENU_PERMISSIONS }o--|| MENU_GROUPS : grants
    ROLE_MENU_PERMISSIONS {
        uuid id PK
        uuid roleId FK
        uuid menuGroupId FK
        string roleType
    }

    MENU_GROUPS ||--o{ ROLE_MENU_PERMISSIONS : controls
    MENU_GROUPS {
        uuid id PK
        string name
        string path
        string icon
    }

    PERMISSIONS ||--o{ USER_PERMISSIONS : grants
    PERMISSIONS {
        uuid id PK
        string name
        string module
        string action
    }

    USER_PERMISSIONS }o--|| USERS : belongs
    USER_PERMISSIONS }o--|| PERMISSIONS : belongs

    SESSIONS }o--|| USERS : belongs
    SESSIONS {
        uuid id PK
        uuid userId FK
        string refreshTokenHash
        timestamp expiresAt
        boolean isRevoked
    }

    WAREHOUSES ||--o{ STORAGE_LOCATIONS : contains
    WAREHOUSES ||--o{ STOCKS : holds
    WAREHOUSES ||--o{ STOCK_TRANSFERS : \"source\"
    WAREHOUSES ||--o{ STOCK_TRANSFERS : \"destination\"
    WAREHOUSES {
        uuid id PK
        uuid tenantId FK
        string name
        string code
    }

    STORAGE_LOCATIONS }o--|| WAREHOUSES : belongs
    STORAGE_LOCATIONS ||--o{ STOCKS : holds
    STORAGE_LOCATIONS {
        uuid id PK
        uuid warehouseId FK
        string name
        string code
        int capacity
    }

    STOCKS }o--|| WAREHOUSES : belongs
    STOCKS }o--|| STORAGE_LOCATIONS : belongs
    STOCKS {
        uuid id PK
        uuid warehouseId FK
        uuid locationId FK
        string sku
        int quantity
    }

    STOCK_TRANSFERS }o--|| WAREHOUSES : \"from\"
    STOCK_TRANSFERS }o--|| WAREHOUSES : \"to\"
    STOCK_TRANSFERS {
        uuid id PK
        uuid fromWarehouseId FK
        uuid toWarehouseId FK
        string status
        object items
    }

    STOCK_ADJUSTMENTS }o--|| WAREHOUSES : belongs
    STOCK_ADJUSTMENTS {
        uuid id PK
        uuid warehouseId FK
        string type
        object items
    }

    STOCK_OPNAMES }o--|| WAREHOUSES : belongs
    STOCK_OPNAMES {
        uuid id PK
        uuid warehouseId FK
        string status
        object results
    }

    CALIBRATION_DEVICES ||--o{ CALIBRATION_RECORDS : has
    CALIBRATION_DEVICES ||--o{ CERTIFICATES : generates
    CALIBRATION_DEVICES }o--|| TENANTS : belongs
    CALIBRATION_DEVICES {
        uuid id PK
        uuid tenantId FK
        string name
        string serialNumber
        string manufacturer
        string model
        string status
        date nextCalibrationDate
    }

    CALIBRATION_RECORDS }o--|| CALIBRATION_DEVICES : belongs
    CALIBRATION_RECORDS {
        uuid id PK
        uuid deviceId FK
        uuid performedBy FK
        date calibrationDate
        date dueDate
        string standard
        object results
        boolean isCompliant
    }

    CERTIFICATES }o--|| CALIBRATION_RECORDS : linked
    CERTIFICATES {
        uuid id PK
        uuid deviceId FK
        uuid calibrationRecordId FK
        string certificateNumber
        string type
        string status
        timestamp signedAt
        string digitalSignature
    }

    TENANT_BACKUPS }o--|| TENANTS : belongs
    TENANT_BACKUPS {
        uuid id PK
        uuid tenantId FK
        string status
        string filePath
    }

    TENANTS ||--o{ KANBAN_PROJECTS : has
    KANBAN_PROJECTS ||--o{ KANBAN_PROJECT_MEMBERS : grants
    KANBAN_PROJECTS ||--o{ KANBAN_COLUMNS : has
    KANBAN_PROJECTS ||--o{ KANBAN_SPRINTS : has
    KANBAN_PROJECTS ||--o{ KANBAN_CARDS : contains
    KANBAN_PROJECTS ||--o{ KANBAN_LABELS : defines
    KANBAN_PROJECTS {
        uuid id PK
        uuid tenantId FK
        string name
        string code
        int cardSeq
    }
    KANBAN_PROJECT_MEMBERS }o--|| KANBAN_PROJECTS : belongs
    KANBAN_PROJECT_MEMBERS {
        uuid id PK
        uuid projectId FK
        uuid userId FK
        uuid roleId FK
        string accessLevel
    }
    KANBAN_COLUMNS ||--o{ KANBAN_CARDS : holds
    KANBAN_COLUMNS {
        uuid id PK
        uuid projectId FK
        string name
        int position
        boolean isDone
    }
    KANBAN_SPRINTS ||--o{ KANBAN_CARDS : scopes
    KANBAN_SPRINTS {
        uuid id PK
        uuid projectId FK
        string name
        string status
    }
    KANBAN_CARDS ||--o{ KANBAN_CARD_ASSIGNEES : tagged
    KANBAN_CARDS ||--o{ KANBAN_CARD_LABELS : labeled
    KANBAN_CARDS ||--o{ KANBAN_CARD_RELATIONS : links
    KANBAN_CARDS {
        uuid id PK
        uuid projectId FK
        uuid columnId FK
        uuid sprintId FK
        int number
        string cardKey
        string title
        string priority
    }
    KANBAN_LABELS ||--o{ KANBAN_CARD_LABELS : applied
    KANBAN_LABELS {
        uuid id PK
        uuid projectId FK
        string name
        string color
    }
    KANBAN_CARD_RELATIONS }o--|| KANBAN_CARDS : from
    KANBAN_CARD_RELATIONS {
        uuid id PK
        uuid sourceCardId FK
        uuid targetCardId FK
        string type
    }
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "05-middleware-pipeline",
    title: "Middleware Pipeline",
    mermaid: `
graph LR
    Req[Incoming Request] --> Sanitizer[Global Sanitizer<br/>XSS Protection]
    Sanitizer --> RateLimiter[Token Rate Limiter]
    RateLimiter --> Auth[JWT Authentication]
    Auth --> TenantCtx[Tenant Context<br/>Identification]
    TenantCtx --> TenantScope[Tenant Scope<br/>Query Binding]
    TenantScope --> DynamicAccess[Dynamic Access<br/>Permission Matrix]
    DynamicAccess --> InputValidation[Input Validation<br/>Joi Schema]
    InputValidation --> Controller[Controller Handler]
    Controller --> ActivityLog[Activity Log]
    ActivityLog --> AuditLog[Audit Log]
    AuditLog --> Resp[Response]

    Auth -.-> JWT[(Redis Session Cache)]
    DynamicAccess -.-> Perm[(Redis Permission Matrix)]
    RateLimiter -.-> Limits[(Redis Rate Limits)]

    style Req fill:#e1f5fe
    style Controller fill:#fff3e0
    style Resp fill:#e8f5e9
    style JWT fill:#f3e5f5
    style Perm fill:#f3e5f5
    style Limits fill:#f3e5f5
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "06-api-endpoints",
    title: "API Endpoints Reference",
    mermaid: `
graph TB
    subgraph Auth["Auth Module"]
        R1["POST /api/v1/auth/register"]
        R2["GET /api/v1/auth/activation"]
        R3["POST /api/v1/auth/login"]
        R4["POST /api/v1/auth/send-otp"]
        R5["POST /api/v1/auth/reset-password"]
        R6["POST /api/v1/auth/logout"]
        R7["POST /api/v1/auth/logout-all"]
        R8["POST /api/v1/auth/verify"]
        R9["POST /api/v1/auth/just-update-password"]
        R10["POST /api/v1/auth/pass-is-valid"]
        R11["POST /api/v1/auth/refresh"]
        R12["POST /api/v1/auth/sso/login"]
        R13["POST /api/v1/auth/sso/callback"]
        R14["GET /api/v1/auth/sso/metadata"]
    end

    subgraph Users["Users Module"]
        U1["GET /api/v1/users/all"]
        U2["POST /api/v1/users/detail"]
        U3["POST /api/v1/users/create"]
        U4["PATCH /api/v1/users/edit"]
        U5["DELETE /api/v1/users/delete"]
    end

    subgraph Roles["Roles Module"]
        S1["GET /api/v1/roles/all"]
        S2["POST /api/v1/roles/detail"]
        S3["POST /api/v1/roles/create"]
        S4["PATCH /api/v1/roles/edit"]
        S5["DELETE /api/v1/roles/delete"]
    end

    subgraph Tenants["Tenants Module"]
        T1["GET /api/v1/tenants/all"]
        T2["POST /api/v1/tenants/detail"]
        T3["POST /api/v1/tenants/create"]
        T4["PATCH /api/v1/tenants/edit"]
        T5["DELETE /api/v1/tenants/delete"]
    end

    subgraph Sessions["Sessions Module"]
        SE1["GET /api/v1/sessions/all"]
        SE2["POST /api/v1/sessions/revoke"]
    end

    subgraph Backup["Tenant Backup Module"]
        B1["POST /api/v1/tenants/:id/backups"]
        B2["POST /api/v1/tenants/:id/backups/restore"]
        B3["GET /api/v1/tenants/:id/backups/stats"]
    end

    subgraph Calibration["Calibration Module"]
        C1["GET /api/v1/calibration-devices/all"]
        C2["POST /api/v1/calibration-devices/create"]
        C3["GET /api/v1/calibration-records/all"]
        C4["POST /api/v1/certificates/approve"]
        C5["POST /api/v1/certificates/sign"]
        C6["POST /api/v1/certificates/revoke"]
    end

    subgraph Stock["Stock Module"]
        K1["GET /api/v1/stock/all"]
        K2["POST /api/v1/stock/add"]
        K3["POST /api/v1/stock/remove"]
        K4["POST /api/v1/stock/transfer"]
        K5["POST /api/v1/stock/adjustment"]
        K6["POST /api/v1/stock/opname"]
    end

    subgraph Warehouse["Warehouse Module"]
        W1["GET /api/v1/warehouse/all"]
        W2["POST /api/v1/warehouse/create"]
        W3["GET /api/v1/warehouse/storage-locations"]
        W4["POST /api/v1/warehouse/location/create"]
    end

    subgraph Kanban["Kanban Module"]
        KB1["GET /api/v1/kanban/projects"]
        KB2["POST /api/v1/kanban/projects"]
        KB3["GET /api/v1/kanban/projects/:id?sprintId"]
        KB4["GET /api/v1/kanban/projects/:id/metrics"]
        KB5["POST /api/v1/kanban/projects/:id/cards"]
        KB6["PATCH /api/v1/kanban/projects/:id/cards/:cid/move"]
        KB7["POST /api/v1/kanban/projects/:id/cards/:cid/relations"]
        KB8["POST /api/v1/kanban/projects/:id/sprints/migrate"]
        KB9["POST /api/v1/kanban/projects/:id/columns/reorder"]
    end

    style Auth fill:#e3f2fd
    style Users fill:#e3f2fd
    style Roles fill:#e3f2fd
    style Tenants fill:#e3f2fd
    style Sessions fill:#e3f2fd
    style Backup fill:#e3f2fd
    style Calibration fill:#f3e5f5
    style Stock fill:#fff3e0
    style Warehouse fill:#fff3e0
    style Kanban fill:#e8f5e9
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "07-multi-tenancy",
    title: "Multi-Tenancy Architecture",
    mermaid: `
graph TB
    subgraph Tenant1["Tenant: Hospital A"]
        T1Users[Users]
        T1Devices[Calibration Devices]
        T1Stock[Stock & Warehouse]
        T1Records[Calibration Records]
        T1Settings[Tenant Settings]
    end

    subgraph Tenant2["Tenant: Hospital B"]
        T2Users[Users]
        T2Devices[Calibration Devices]
        T2Stock[Stock & Warehouse]
        T2Records[Calibration Records]
        T2Settings[Tenant Settings]
    end

    subgraph SuperAdmin["Super Admin (System Owner)"]
        SAUsers[System-wide Users]
        SATenants[All Tenants]
        SASessions[System Sessions]
    end

    subgraph SharedTables["Shared Database - Schemas"]
        Tenants[(Tenants Table)]
        Users[(Users Table)]
        Devices[(CalibrationDevices Table)]
        Records[(CalibrationRecords Table)]
        Stock[(Stocks Table)]
        Warehouse[(Warehouses Table)]
        Sessions[(Sessions Table)]
        Settings[(TenantSettings Table)]
        Backups[(TenantBackups Table)]
    end

    Tenant1Users --> Users
    Tenant1Devices --> Devices
    Tenant1Stock --> Stock
    Tenant1Records --> Records
    Tenant1Settings --> Settings

    Tenant2Users --> Users
    Tenant2Devices --> Devices
    Tenant2Stock --> Stock
    Tenant2Records --> Records
    Tenant2Settings --> Settings

    SAUsers --> Users
    SATenants --> Tenants
    SASessions --> Sessions

    Users -.->|tenantId FK| Tenants
    Devices -.->|tenantId FK| Tenants
    Records -.->|tenantId FK| Tenants
    Stock -.->|tenantId FK| Tenants
    Warehouse -.->|tenantId FK| Tenants
    Settings -.->|tenantId FK| Tenants
    Backups -.->|tenantId FK| Tenants

    style Tenant1 fill:#e3f2fd
    style Tenant2 fill:#e8f5e9
    style SuperAdmin fill:#fff3e0
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "08-backup-logging",
    title: "Backup & Logging System",
    mermaid: `
graph TB
    subgraph Backup["Tenant Backup System"]
        BReq["Backup Request"]
        BValidate["Validate Tenant"]
        BDump["pg_dump SQL"]
        BStore["Store Backup File"]
        BUpdate["Update Status"]
    end

    subgraph Restore["Tenant Restore"]
        RReq["Restore Request"]
        RValidate["Validate Backup"]
        RDrop["Drop Tenant DB"]
        RRestore["pg_restore"]
        RUpdate["Update Status"]
    end

    subgraph Logging["Logging System (Winston)"]
        LogEntry["Log Entry"]
        LogHTTP["HTTP Logs"]
        LogError["Error Logs"]
        LogActivity["Activity Logs"]
        LogAudit["Audit Logs"]
        LogDB["Database Logs"]
    end

    subgraph Storage["Storage"]
        BackupFile["Backup File (S3/Local)"]
        LogFile["Log File (Rotated)"]
    end

    subgraph Status["Backup Status Flow"]
        Pending["pending"]
        Running["running"]
        Done["done"]
        Error["error"]
    end

    BReq --> BValidate
    BValidate --> BDump
    BDump --> BStore
    BStore --> BUpdate

    RReq --> RValidate
    RValidate --> RDrop
    RDrop --> RRestore
    RRestore --> RUpdate

    LogEntry --> LogHTTP
    LogEntry --> LogError
    LogEntry --> LogActivity
    LogEntry --> LogAudit
    LogEntry --> LogDB

    BStore --> BackupFile
    LogFile -.-> LogHTTP

    BUpdate --> Pending
    BUpdate --> Running
    Running --> Done
    Running --> Error

    style Backup fill:#e3f2fd
    style Restore fill:#fff3e0
    style Logging fill:#f3e5f5
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "09-security-layers",
    title: "Security Layers",
    mermaid: `
graph TB
    subgraph L1["Layer 1: Network"]
        CORS["CORS Configuration"]
        Helmet["Helmet - HTTP Headers"]
        HPP["HTTP Parameter Pollution"]
    end

    subgraph L2["Layer 2: Input"]
        Sanitizer["XSS Sanitizer"]
        Validator["Joi Schema Validation"]
        UUID["UUID Parameter Validation"]
    end

    subgraph L3["Layer 3: Authentication"]
        JWT["JWT Bearer Token"]
        Refresh["Refresh Token Validation"]
        RateLimit["Token Bucket Rate Limiter"]
    end

    subgraph L4["Layer 4: Authorization"]
        RBAC["Role-Based Access"]
        DynamicPerm["Dynamic Permission Matrix"]
        ABAC["Attribute-Based Access"]
    end

    subgraph L5["Layer 5: Data"]
        TenantScope["Tenant Isolation"]
        Password["bcrypt Hashing"]
        Session["Session Management"]
    end

    subgraph L6["Layer 6: Audit"]
        Activity["Activity Logging"]
        Audit["Audit Trail"]
        AccessLog["Access Logging"]
    end

    L1 --> L2 --> L3 --> L4 --> L5 --> L6

    CORS -.-> L1
    Helmet -.-> L1
    HPP -.-> L1

    Sanitizer -.-> L2
    Validator -.-> L2
    UUID -.-> L2

    JWT -.-> L3
    Refresh -.-> L3
    RateLimit -.-> L3

    RBAC -.-> L4
    DynamicPerm -.-> L4
    ABAC -.-> L4

    TenantScope -.-> L5
    Password -.-> L5
    Session -.-> L5

    Activity -.-> L6
    Audit -.-> L6
    AccessLog -.-> L6

    style L1 fill:#e3f2fd
    style L2 fill:#e8f5e9
    style L3 fill:#fff3e0
    style L4 fill:#fce4ec
    style L5 fill:#f3e5f5
    style L6 fill:#efebe9
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "10-project-structure",
    title: "Project Structure",
    mermaid: `
graph TB
    subgraph Root["backend/"]
        Index["index.js<br/>Entry Point"]
        Package["package.json"]
        Dockerfile["Dockerfile"]
        Compose["docker-compose.yaml"]
        Env[".env"]

        Src["src/"]
        Docs["docs/"]
        Scripts["scripts/"]
        Uploads["uploads/"]
        Public["public/"]
    end

    subgraph Src["src/"]
        Config["config/<br/>DB, Redis, App"]
        Constants["constants/<br/>Permissions, Roles"]
        Controllers["controllers/<br/>Request Handlers"]
        Middlewares["middlewares/<br/>Auth, RBAC, ABAC"]
        Models["models/<br/>Sequelize Models"]
        Routes["routes/<br/>API Routes"]
        Services["services/<br/>Business Logic"]
        Templates["templates/<br/>Email HTML"]
        Tests["tests/<br/>Jest Tests"]
        Utils["utils/<br/>Helpers"]
        Validators["validators/<br/>Joi Schemas"]
        DocsAPI["docs/<br/>Swagger Config"]
    end

    subgraph Routes["routes/"]
        API["api/<br/>Public Routes"]
        Internal["internal/<br/>Migration Routes"]
    end

    subgraph Controllers["controllers/"]
        Auth["auth.controller.js"]
        User["user.controller.js"]
        Role["roles.controller.js"]
        Tenant["tenant.controller.js"]
        Session["session.controller.js"]
        Backup["tenantBackup.controller.js"]
        Calibration["calibrationDevices.controller.js"]
        Record["calibrationRecords.controller.js"]
        Certificate["certificate.controller.js"]
        Stock["stock.controller.js"]
        Warehouse["warehouse.controller.js"]
    end

    subgraph Services["services/"]
        AuthService["auth.service.js"]
        UserService["user.service.js"]
        RoleService["roles.service.js"]
        TenantService["tenant.service.js"]
        SessionService["session.service.js"]
        EmailService["email.service.js"]
        EmailQueue["emailQueue.service.js"]
        RedisService["redis.service.js"]
        RateLimiter["rateLimiter.service.js"]
        StockService["stock.service.js"]
        WarehouseService["warehouse.service.js"]
        BackupService["tenantBackup.service.js"]
        CalibrationService["calibrationDevices.service.js"]
        RecordService["calibrationRecords.service.js"]
        CertificateService["certificate.service.js"]
    end

    Root --> Index
    Root --> Package
    Root --> Dockerfile
    Root --> Compose
    Root --> Env
    Root --> Src
    Root --> Docs
    Root --> Scripts
    Root --> Uploads
    Root --> Public

    Src --> Config
    Src --> Constants
    Src --> Controllers
    Src --> Middlewares
    Src --> Models
    Src --> Routes
    Src --> Services
    Src --> Templates
    Src --> Tests
    Src --> Utils
    Src --> Validators
    Src --> DocsAPI

    Routes --> API
    Routes --> Internal

    Controllers --> Auth
    Controllers --> User
    Controllers --> Role
    Controllers --> Tenant
    Controllers --> Session
    Controllers --> Backup
    Controllers --> Calibration
    Controllers --> Record
    Controllers --> Certificate
    Controllers --> Stock
    Controllers --> Warehouse

    Services --> AuthService
    Services --> UserService
    Services --> RoleService
    Services --> TenantService
    Services --> SessionService
    Services --> EmailService
    Services --> EmailQueue
    Services --> RedisService
    Services --> RateLimiter
    Services --> StockService
    Services --> WarehouseService
    Services --> BackupService
    Services --> CalibrationService
    Services --> RecordService
    Services --> CertificateService

    style Root fill:#fff
    style Src fill:#e3f2fd
    style Controllers fill:#fff3e0
    style Services fill:#e8f5e9
    style Middlewares fill:#f3e5f5
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "11-docker-architecture",
    title: "Docker Architecture",
    mermaid: `
graph TB
    subgraph Docker["Docker Compose Services"]
        Backend["Backend API<br/>Node.js 18+<br/>Express.js 5.x<br/>Port: 5000"]
        PostgreSQL["PostgreSQL<br/>Version: 14+<br/>Port: 5432"]
        RedisDB["Redis<br/>Version: 7+<br/>Port: 6379"]
        RabbitMQS["RabbitMQ<br/>Version: 3.13+<br/>Port: 5672 / 15672"]
    end

    subgraph Volumes["Docker Volumes"]
        DBData["PostgreSQL Data<br/>pg_data"]
        RedisData["Redis Data<br/>redis_data"]
        MQData["RabbitMQ Data<br/>rabbitmq_data"]
    end

    subgraph Networks["Docker Network"]
        BackendNet["callibrator-network"]
    end

    subgraph Env["Environment"]
        DBEnv["DB_HOST, DB_PORT<br/>DB_NAME, DB_USER<br/>DB_PASS"]
        RedisEnv["REDIS_URL"]
        MQEnv["RABBITMQ_URL"]
        JWTEnv["JWT_ACCESS_SECRET<br/>JWT_REFRESH_SECRET"]
    end

    Backend --> DBEnv
    Backend --> RedisEnv
    Backend --> MQEnv
    Backend --> JWTEnv

    Backend --> PostgreSQL
    Backend --> RedisDB
    Backend --> RabbitMQS

    PostgreSQL --> DBData
    RedisDB --> RedisData
    RabbitMQS --> MQData

    Backend --> BackendNet
    PostgreSQL --> BackendNet
    RedisDB --> BackendNet
    RabbitMQS --> BackendNet

    style Backend fill:#fff3e0
    style PostgreSQL fill:#e3f2fd
    style RedisDB fill:#e8f5e9
    style RabbitMQS fill:#f3e5f5
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "12-table-permissions-architecture",
    title: "Table Permissions Architecture",
    mermaid: `
graph TB
    subgraph Core["Core Permission System"]
        Roles["Roles Table"]
        Permissions["Permissions Table<br/>module:action format"]
        RolePerms["RolePermissions<br/>Role-Permission Mapping"]
    end

    subgraph TablePerm["Table Permission System"]
        TablePerms["TablePermissions<br/>Dynamic Table Rules"]
        Models["Discovered Models<br/>Auto-registered at startup"]
        TablePermsSeed["Table Permissions Seeder"]
    end

    subgraph Flow["Permission Check Flow"]
        Request["API Request"]
        Auth["JWT Auth"]
        RoleCheck["Role-Based Check"]
        TableCheck["Table Permission Check"]
        Result["Access Granted/Denied"]
    end

    subgraph ModelDiscovery["Model Discovery"]
        ModelScan["Scan models/ Directory"]
        Register["Register to Models Table"]
        AutoSeed["Auto-seed Table Permissions"]
    end

    Roles --> RolePerms
    Permissions --> RolePerms
    Roles --> TablePerms

    ModelScan --> Register
    Register --> AutoSeed
    AutoSeed --> TablePerms

    TablePerms --> Models

    Request --> Auth
    Auth --> RoleCheck
    RoleCheck --> TableCheck
    TableCheck --> Result

    RolePerms -.-> RoleCheck
    TablePerms -.-> TableCheck

    style Core fill:#e3f2fd
    style TablePerm fill:#f3e5f5
    style Flow fill:#fff3e0
    style ModelDiscovery fill:#e8f5e9
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "13-table-permissions-flow",
    title: "Table Permissions Flow",
    mermaid: `
sequenceDiagram
    participant S as Startup
    participant M as ModelDiscovery
    participant D as Models Table
    participant T as TablePermissions
    participant R as SUPER_ADMIN
    participant U as Regular User

    Note over S,T: Startup Phase
    S->>M: discoverAllModels()
    M->>D: Register all models
    M->>T: Seed default permissions
    T-->>S: Ready

    Note over U,T: Permission Check
    U->>T: API Request (tenant:tenant:read)
    T->>T: Check role permissions
    T->>T: Check table permissions
    T-->>U: Access Granted/Denied

    Note over R,T: SUPER_ADMIN Bypass
    R->>T: API Request
    T->>T: Check role level
    T->>T: Is SUPER_ADMIN?
    T-->>R: Full Access (bypass table perms)
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "14-table-permissions-erd",
    title: "Table Permissions ER Diagram",
    mermaid: `
erDiagram
    ROLES ||--o{ ROLE_PERMISSIONS : has
    ROLES ||--o{ TABLE_PERMISSIONS : has
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : grants
    PERMISSIONS ||--o{ TABLE_PERMISSIONS : defines

    MODELS {
        string modelName PK
        string tableName
        string module
        int attributeCount
        json attributes
        int relationCount
        json relations
    }

    TABLE_PERMISSIONS }o--|| MODELS : references
    TABLE_PERMISSIONS }o--|| ROLES : applies-to

    ROLES {
        uuid id PK
        string name
        int level
        string status
    }

    PERMISSIONS {
        uuid id PK
        string name
        string module
        string action
    }

    ROLE_PERMISSIONS {
        uuid id PK
        uuid roleId FK
        uuid permissionId FK
    }

    TABLE_PERMISSIONS {
        uuid id PK
        uuid roleId FK
        string modelTable
        string actions
        boolean isActive
    }
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "15-menu-group-architecture",
    title: "Menu Group Architecture",
    mermaid: `
graph TB
    subgraph Menu["Menu System"]
        MenuGroups["MenuGroups<br/>Top-level Categories"]
        MenuItems["MenuItems<br/>Individual Links"]
        MenuRoles["MenuRoles<br/>Role-to-Menu Mapping"]
        UserGrants["UserMenuGrants<br/>User Overrides"]
    end

    subgraph Types["Grant Types"]
        GrantGroup["menu-group<br/>See entire group"]
        GrantItem["menu-item<br/>See specific item"]
        BlockGroup["block-group<br/>Hide group"]
        BlockItem["block-item<br/>Hide item"]
    end

    subgraph Hierarchy["Role Hierarchy"]
        SuperAdmin["SUPER_ADMIN<br/>Level 3 - Full Access"]
        TenantAdmin["TENANT_ADMIN<br/>Level 2 - Tenant Mgmt"]
        User["USER<br/>Level 1 - Self Access"]
    end

    subgraph Flow["Menu Resolution"]
        BuildMenu["buildUserMenu()"]
        CheckGrants["Check user_menu_grants"]
        ExcludeBlocks["Exclude blocks"]
        IncludeGrants["Include grants"]
        Tree["Sorted Menu Tree"]
    end

    MenuGroups --> MenuRoles
    MenuItems --> MenuRoles
    MenuRoles --> UserGrants

    GrantGroup -.-> MenuRoles
    GrantItem -.-> MenuRoles
    BlockGroup -.-> UserGrants
    BlockItem -.-> UserGrants

    SuperAdmin --> BuildMenu
    User --> BuildMenu

    BuildMenu --> CheckGrants
    CheckGrants --> ExcludeBlocks
    ExcludeBlocks --> IncludeGrants
    IncludeGrants --> Tree

    style Menu fill:#e3f2fd
    style Types fill:#f3e5f5
    style Hierarchy fill:#fff3e0
    style Flow fill:#e8f5e9
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "16-user-menu-resolution",
    title: "User Menu Resolution Flow",
    mermaid: `
sequenceDiagram
    participant C as Frontend
    participant API as My Menu API
    participant S as buildUserMenu
    participant DB as user_menu_grants
    participant M as menu_items

    Note over C,M: Menu Resolution
    C->>API: POST /api/v1/menu-groups/my-menu
    API->>S: buildUserMenu(userId, roleId)

    alt SUPER_ADMIN
        S->>M: Get ALL active menus
        M-->>S: All menus
        S-->>API: Full menu tree
    else Regular User
        S->>DB: Query grants & blocks
        DB-->>S: User grants/blocks
        S->>M: Get menu groups/items
        M-->>S: Available menus

        S->>S: Include grants
        S->>S: Exclude blocks
        S->>S: Deduplicate & sort
        S-->>API: Resolved menu tree
    end

    API-->>C: { menus, items }
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "21-calibration-lifecycle",
    title: "Calibration Device & Record Lifecycle",
    mermaid: `
flowchart TD
    Start([Device Registered]) --> A[Device Status: Active]
    A --> B{Next Calibration Date Due?}
    B -- Yes --> C[Schedule Calibration]
    B -- No --> A
    C --> D[Perform Physical Calibration]
    D --> E[Create CalibrationRecord]
    E --> F{Is Compliant?}
    F -- Yes --> G[Generate Certificate]
    F -- No --> H[Mark Device Status: Out-of-service / Refit]
    G --> I[Sign Certificate Digitally]
    I --> J[Update Next Calibration Date]
    J --> A
    H --> K[Perform Maintenance / Repair]
    K --> D
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "22-stock-transfer-flow",
    title: "Stock Transfer Sequence Flow",
    mermaid: `
sequenceDiagram
    autonumber
    actor Mgr as Warehouse Manager
    participant S as Stock Service
    participant W_Src as Source Warehouse
    participant W_Dest as Destination Warehouse
    participant DB as PostgreSQL Database

    Mgr->>S: POST /api/v1/stock/transfer (from, to, items)
    activate S
    S->>DB: Check source stock availability
    DB-->>S: Available quantity
    alt Stock Available
        S->>DB: Create StockTransfer (status: pending)
        S->>DB: Deduct quantity from Source Stock
        S->>W_Src: Dispatch items (status: in-transit)
        W_Src-->>Mgr: Items shipped
        Mgr->>S: POST /api/v1/stock/transfer/:id/receive
        S->>DB: Update StockTransfer (status: completed)
        S->>DB: Add/Increase quantity in Destination Stock
        S-->>Mgr: Transfer completed successfully
    else Stock Insufficient
        S-->>Mgr: Error: Insufficient stock at source
    end
    deactivate S
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "23-certificate-lifecycle",
    title: "Certificate Lifecycle State Diagram",
    mermaid: `
stateDiagram-v2
    [*] --> DRAFT : Create Record
    DRAFT --> PENDING_APPROVAL : Submit for Approval
    PENDING_APPROVAL --> APPROVED : Approve
    PENDING_APPROVAL --> DRAFT : Reject
    APPROVED --> SIGNED_LOCKED : Sign Digitally (Lock)
    SIGNED_LOCKED --> REVOKED : Revoke / Device Out-of-Service
    APPROVED --> REVOKED : Revoke
    REVOKED --> [*]
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "29-calibration-scheduler",
    title: "Calibration Scheduler",
    mermaid: `
sequenceDiagram
    participant Cron as Scheduler (cron)
    participant SVC as Scheduler Service
    participant DB as PostgreSQL
    participant N as Notification Service
    participant U as Assigned User

    Note over Cron,DB: Recurring calibration due-date sweep
    Cron->>SVC: runDueScan()
    SVC->>DB: Find devices with nextCalibrationDate <= window
    SVC->>DB: Upsert calibration schedule entries
    loop For each due/overdue device
        SVC->>N: emitNotification(CALIBRATION, due)
        N->>U: Realtime + persisted alert
    end
    SVC->>DB: Mark schedule status (planned/overdue/done)
    SVC-->>Cron: summary { scanned, due, overdue }
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "32-kanban-architecture",
    title: "Kanban Project Tracker Architecture",
    mermaid: `
graph TB
    subgraph Client["Frontend (Next.js)"]
        BoardUI["Board UI (drag & drop)"]
        DashUI["KPI Analytics Dashboard"]
        SocketC["Socket.IO client"]
    end

    subgraph API["Kanban API (/api/v1/kanban)"]
        Routes["kanban.route.js"]
        Ctrl["kanban.controller.js"]
        Valid["kanban.validator.js (Joi)"]
    end

    subgraph Svc["kanban.service.js"]
        Access["resolveAccess / assertAccess"]
        CardLogic["Cards + card keys (card_seq)"]
        SprintLogic["Sprints + migrate"]
        ColLogic["Columns (persistent Done)"]
        RelLogic["Relations (both directions)"]
        Metrics["getMetrics (KPIs)"]
    end

    subgraph Realtime["Realtime + Notify"]
        Socket["Socket.IO room board_<projectId>"]
        Notify["notification.service"]
    end

    subgraph Store["Data Layer"]
        PG[(PostgreSQL + RLS)]
        Att["Attachment Service (card images)"]
    end

    subgraph Tables["Kanban Tables"]
        T1["kanban_projects"]
        T2["kanban_project_members"]
        T3["kanban_columns"]
        T4["kanban_cards"]
        T5["kanban_sprints"]
        T6["kanban_labels"]
        T7["kanban_card_assignees"]
        T8["kanban_card_labels"]
        T9["kanban_card_relations"]
    end

    BoardUI --> Routes
    DashUI --> Routes
    SocketC -. subscribe .-> Socket
    Routes --> Valid --> Ctrl --> Access
    Ctrl --> CardLogic
    Ctrl --> SprintLogic
    Ctrl --> ColLogic
    Ctrl --> RelLogic
    Ctrl --> Metrics
    CardLogic --> Notify
    CardLogic --> Socket
    SprintLogic --> Socket
    ColLogic --> Socket
    RelLogic --> Socket
    CardLogic --> Att
    Access --> PG
    CardLogic --> PG
    SprintLogic --> PG
    ColLogic --> PG
    RelLogic --> PG
    Metrics --> PG
    PG --- Tables
    Notify --> Socket
    Socket -. emit .-> SocketC

    style Client fill:#e3f2fd
    style API fill:#e8f5e9
    style Svc fill:#fff3e0
    style Realtime fill:#f3e5f5
    style Tables fill:#eceff1
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
  {
    id: "33-kanban-card-lifecycle",
    title: "Kanban Card Lifecycle",
    mermaid: `
stateDiagram-v2
    [*] --> Created : POST /cards (auto card-key MGT-N, active sprint)
    Created --> Assigned : assign / tag users -> notify
    Assigned --> InProgress : move to In Progress column
    Created --> InProgress : move
    InProgress --> Linked : add relation (parent/child, blocks, relates)
    Linked --> InProgress
    InProgress --> Migrated : migrate to next sprint
    Migrated --> InProgress
    InProgress --> Done : move to Done column (persistent, last)
    Done --> InProgress : reopen (move back)
    Done --> Archived : delete (soft, key never recycled)
    Archived --> [*]

    note right of Created
        Every transition emits a Socket.IO
        event to board_<projectId> and
        notifies assignees (SYSTEM).
    end note
    `
      .trim()
      .replace(/\n\s+/g, "\n"),
  },
];

const puppeteer = require("puppeteer");

// ============================================================
// SVG GENERATION VIA PUPPETEER
// ============================================================

async function renderMermaidToSVG(page, id, code) {
  return await page.evaluate(
    async (id, code) => {
      // Clear the container
      const container = document.getElementById("container");
      container.innerHTML = "";

      // Create a temporary div for rendering
      const tempDiv = document.createElement("div");
      tempDiv.id = "temp-" + id;
      container.appendChild(tempDiv);

      try {
        // Render using mermaid
        const { svg } = await window.mermaid.render("rendered-" + id, code);
        return svg;
      } catch (err) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
        <rect width="1200" height="800" fill="#fee2e2" rx="8"/>
        <text x="50%" y="45%" text-anchor="middle" font-size="18" font-weight="bold" fill="#991b1b">Mermaid Rendering Error</text>
        <text x="50%" y="55%" text-anchor="middle" font-size="14" fill="#ef4444">${err.message || err}</text>
      </svg>`;
      }
    },
    id,
    code,
  );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const outputDir = path.join(__dirname, "..", "docs", "illustrations");

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n=== Illustration SVG Generator ===\n`);
  console.log(`Total diagrams: ${DIAGRAMS.length}`);
  console.log(`Output directory: ${outputDir}\n`);

  console.log("🔄 Launching Puppeteer browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  // Load an HTML wrapper page containing mermaid CDN
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
      <script>
        window.addEventListener('DOMContentLoaded', () => {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose'
          });
        });
      </script>
    </head>
    <body>
      <div id="container"></div>
    </body>
    </html>
  `;

  await page.setContent(htmlContent);
  // Wait until mermaid is defined
  await page.waitForFunction(() => typeof window.mermaid !== "undefined");

  let successCount = 0;
  let failCount = 0;

  for (const diagram of DIAGRAMS) {
    try {
      console.log(`Rendering: ${diagram.id}...`);
      const svgContent = await renderMermaidToSVG(
        page,
        diagram.id,
        diagram.mermaid,
      );
      const filePath = path.join(outputDir, `${diagram.id}.svg`);
      fs.writeFileSync(filePath, svgContent);
      console.log(`Generated: ${diagram.id}.svg`);
      successCount++;
    } catch (error) {
      console.error(`Failed: ${diagram.id}.svg - ${error.message}`);
      failCount++;
    }
  }

  await browser.close();

  console.log(`\n=== Summary ===`);
  console.log(`Success: ${successCount}/${DIAGRAMS.length}`);
  console.log(`Failed: ${failCount}/${DIAGRAMS.length}`);
  console.log(`\nOutput directory: ${outputDir}\n`);

}

main().catch(console.error);

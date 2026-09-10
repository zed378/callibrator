/**
 * Generate SVG illustrations using Mermaid erDiagram syntax
 * This script creates properly aligned ER diagrams for all illustrations
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ILLUSTRATIONS_DIR = path.join(__dirname, "..", "docs", "illustrations");

// Ensure illustrations directory exists
if (!fs.existsSync(ILLUSTRATIONS_DIR)) {
  fs.mkdirSync(ILLUSTRATIONS_DIR, { recursive: true });
}

/**
 * Generate SVG from Mermaid using mmdc (Mermaid CLI)
 */
async function generateMermaidSVG(filename, mermaidCode, options = {}) {
  const inputPath = path.join(ILLUSTRATIONS_DIR, `${filename}.mmd`);
  const outputPath = path.join(ILLUSTRATIONS_DIR, filename);

  // Write Mermaid input file
  fs.writeFileSync(inputPath, mermaidCode);

  try {
    // Generate SVG using mmdc
    const cmd = `mmdc -i "${inputPath}" -o "${outputPath}" -w 1200 -H 800${options.theme ? ` -t ${options.theme}` : ""}`;
    execSync(cmd, { cwd: ILLUSTRATIONS_DIR, stdio: "pipe" });
    console.log(`Generated: ${filename}`);

    // Clean up .mmd file
    fs.unlinkSync(inputPath);

    return true;
  } catch (error) {
    console.error(`Error generating ${filename}:`, error.message);
    return false;
  }
}

/**
 * 04 - Database Schema ER Diagram
 */
function generateDatabaseSchema() {
  const mermaidCode = `erDiagram
    TENANTS {
        uuid id PK
        string name
        string code
        string status
        string logo
        int maxUsers
    }

    USERS {
        uuid id PK
        uuid tenantId FK
        string username
        string email
        string password
        string picture
        uuid roleId FK
        uuid tenantRoleId FK
        boolean isEmailVerified
        boolean isBanned
        string status
    }

    ROLES {
        uuid id PK
        string name
        string description
        int roleLevel
        boolean isActive
    }

    PERMISSIONS {
        uuid id PK
        string name
        string module
        string action
        string description
    }

    USER_PERMISSIONS {
        uuid id PK
        uuid userId FK
        uuid permissionId FK
    }

    TENANT_ROLES {
        uuid id PK
        uuid tenantId FK
        string name
        string description
    }

    TENANT_FEATURES {
        uuid id PK
        uuid tenantId FK
        string featureKey
        boolean isEnabled
        json config
        datetime expirationDate
    }

    TENANT_SETTINGS {
        uuid id PK
        uuid tenantId FK
        string settingKey
        text settingValue
    }

    SESSIONS {
        uuid id PK
        uuid userId FK
        string token
        datetime expiredAt
        json data
    }

    LOGIN_LOGS {
        uuid id PK
        uuid userId FK
        string email
        string ipAddress
        string userAgent
        boolean success
    }

    TENANT_AUDIT_LOG {
        uuid id PK
        uuid tenantId FK
        uuid userId FK
        string action
        string entityType
        uuid entityId
        json changes
    }

    TENANT_BACKUP {
        uuid id PK
        uuid tenantId FK
        string name
        string description
        string filePath
        string status
        int fileSize
        string checksum
        datetime restoredAt
    }

    MODELS {
        uuid id PK
        uuid tenantId FK
        string modelName
        text schema
        boolean isActive
    }

    TABLE_PERMISSION {
        uuid id PK
        uuid tenantId FK
        uuid modelId FK
        string tableName
    }

    ROLE_PERMISSION {
        uuid id PK
        uuid roleId FK
        uuid tablePermissionId FK
        json permissions
        uuid createdBy FK
    }

    TENANT_ROLE_PERMISSION {
        uuid id PK
        uuid tenantRoleId FK
        uuid tablePermissionId FK
        json permissions
        datetime expiresAt
    }

    TENANTS ||--o{ USERS : "has"
    TENANTS ||--o{ TENANT_ROLES : "has"
    TENANTS ||--o{ TENANT_FEATURES : "has"
    TENANTS ||--o{ TENANT_SETTINGS : "has"
    TENANTS ||--o{ TENANT_AUDIT_LOG : "records"
    TENANTS ||--o{ TENANT_BACKUP : "has"
    TENANTS ||--o{ SESSIONS : "has"
    TENANTS ||--o{ MODELS : "has"
    TENANTS ||--o{ TABLE_PERMISSION : "has"
    
    USERS }o--|| ROLES : "belongs to"
    USERS }o--|| TENANT_ROLES : "belongs to"
    USERS ||--o{ USER_PERMISSIONS : "has"
    USERS ||--o{ SESSIONS : "has"
    USERS ||--o{ LOGIN_LOGS : "has"
    
    ROLES ||--o{ ROLE_PERMISSION : "has"
    
    PERMISSIONS ||--o{ USER_PERMISSIONS : "has"
    
    USER_PERMISSIONS }o--|| PERMISSIONS : "grants"
    
    TABLE_PERMISSION ||--o{ ROLE_PERMISSION : "has"
    TABLE_PERMISSION ||--o{ TENANT_ROLE_PERMISSION : "has"
    TABLE_PERMISSION }o--|| MODELS : "for"
`;

  return generateMermaidSVG("04-database-schema.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 01 - System Architecture (using graph for better layout)
 */
function generateSystemArchitecture() {
  const mermaidCode = `graph TD
    subgraph Client["Client Layer"]
        Web[Web Browser]
        Mobile[Mobile App]
        API[API Client]
    end

    subgraph Edge["Edge Layer"]
        CDN[CDN]
        LB[Load Balancer]
    end

    subgraph Application["Application Layer"]
        Backend[Backend Service<br/>Node.js/Express]
        Middleware[Middleware Pipeline]
    end

    subgraph Security["Security Layer"]
        Auth[Authentication<br/>JWT/Sessions]
        RBAC[RBAC/ABAC]
        RateLimit[Rate Limiting]
    end

    subgraph Data["Data Layer"]
        PostgreSQL[(PostgreSQL<br/>Primary)]
        Redis[(Redis Cache)]
        RabbitMQ[(RabbitMQ<br/>Message Queue)]
        FileSystem[File System<br/>Uploads/Backups]
    end

    subgraph Services["External Services"]
        SMTP[SMTP Server]
        S3[Object Storage]
    end

    Web --> CDN
    Mobile --> CDN
    API --> CDN
    CDN --> LB
    LB --> Backend
    Backend --> Middleware
    Middleware --> Auth
    Middleware --> RBAC
    Middleware --> RateLimit
    Backend --> PostgreSQL
    Backend --> Redis
    Backend --> RabbitMQ
    Backend --> FileSystem
    Backend --> SMTP
    Backend --> S3
    PostgreSQL --> FileSystem
`;

  return generateMermaidSVG("01-system-architecture.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 02 - Authentication Flow
 */
function generateAuthenticationFlow() {
  const mermaidCode = `sequenceDiagram
    participant User as User
    participant Frontend as Frontend App
    participant Auth as Auth Service
    participant DB as Database
    participant Cache as Redis Cache
    participant Queue as RabbitMQ
    participant Email as Email Service

    User->>Frontend: Register (email, password)
    Frontend->>Auth: POST /api/v1/auth/register
    Auth->>Auth: Validate input
    Auth->>Auth: Hash password
    Auth->>DB: Create user record
    DB-->>Auth: User created
    Auth->>Queue: Add activation email job
    Queue-->>Auth: Job queued
    Auth-->>Frontend: Activation token
    Frontend-->>User: Check email

    User->>Frontend: Click activation link
    Frontend->>Auth: GET /api/v1/auth/activate
    Auth->>Cache: Check cache
    Cache-->>Auth: Miss
    Auth->>DB: Verify token & user
    DB-->>Auth: User verified
    Auth->>DB: Update isEmailVerified
    Auth->>Cache: Cache user
    Auth-->>Frontend: User activated
    Frontend-->>User: Account activated

    User->>Frontend: Login (email, password)
    Frontend->>Auth: POST /api/v1/auth/login
    Auth->>DB: Find user
    DB-->>Auth: User found
    Auth->>Auth: Verify password
    Auth->>Auth: Check RBAC/ABAC
    Auth->>DB: Create session
    Auth->>Cache: Store session
    Auth-->>Frontend: JWT + Refresh token
    Frontend-->>User: Logged in

    User->>Frontend: Access protected resource
    Frontend->>Auth: POST with JWT
    Auth->>Cache: Verify token
    Cache-->>Auth: Valid
    Auth->>DB: Check permissions
    DB-->>Auth: Permissions
    Auth-->>Frontend: 200 OK + Data
    Frontend-->>User: Display data
`;

  return generateMermaidSVG("02-authentication-flow.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 03 - RBAC/ABAC Authorization
 */
function generateRBACABAC() {
  const mermaidCode = `erDiagram
    ROLES {
        uuid id PK
        string name
        int roleLevel
        boolean isActive
    }

    TENANT_ROLES {
        uuid id PK
        uuid tenantId FK
        string name
        string description
    }

    PERMISSIONS {
        uuid id PK
        string name
        string module
        string action
    }

    USER_PERMISSIONS {
        uuid id PK
        uuid userId FK
        uuid permissionId FK
    }

    TABLE_PERMISSION {
        uuid id PK
        uuid tenantId FK
        string tableName
    }

    ROLE_PERMISSION {
        uuid id PK
        uuid roleId FK
        uuid tablePermissionId FK
        json permissions
    }

    TENANT_ROLE_PERMISSION {
        uuid id PK
        uuid tenantRoleId FK
        uuid tablePermissionId FK
        json permissions
        json abacRules
    }

    USERS {
        uuid id PK
        uuid roleId FK
        uuid tenantRoleId FK
        string status
    }

    RESOURCES {
        string type
        uuid ownerId
        json attributes
        string sensitivity
    }

    ROLES ||--o{ USER_PERMISSIONS : "grants"
    ROLES ||--o{ ROLE_PERMISSION : "defines"
    TENANT_ROLES ||--o{ TENANT_ROLE_PERMISSION : "defines"
    PERMISSIONS ||--o{ USER_PERMISSIONS : "has"
    PERMISSIONS ||--o{ ROLE_PERMISSION : "has"
    TABLE_PERMISSION ||--o{ ROLE_PERMISSION : "has"
    TABLE_PERMISSION ||--o{ TENANT_ROLE_PERMISSION : "has"
    
    USERS }o--|| ROLES : "system"
    USERS }o--|| TENANT_ROLES : "tenant"
    
    TENANT_ROLE_PERMISSION }o--|| RESOURCES : "ABAC evaluates"
`;

  return generateMermaidSVG("03-rbac-abac.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 05 - Middleware Pipeline
 */
function generateMiddlewarePipeline() {
  const mermaidCode = `graph LR
    Request[Request] --> BodyParser[Body Parser]
    BodyParser --> Sanitizer[Global Sanitizer]
    Sanitizer --> Validation[Input Validation]
    Validation --> TenantContext[Tenant Context]
    TenantContext --> TenantScope[Tenant Scope]
    TenantScope --> Auth[Authentication]
    Auth --> RBAC[RBAC Check]
    RBAC --> ABAC[ABAC Check]
    ABAC --> RateLimit[Rate Limiter]
    RateLimit --> ActivityLog[Activity Logger]
    ActivityLog --> Controller[Controller]
    Controller --> Response[Response]
    
    Error[Error Handler] -.-> Auth
    Error -.-> RBAC
    Error -.-> ABAC
    NotFound[404 Handler] -.-> Request
`;

  return generateMermaidSVG("05-middleware-pipeline.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 06 - API Endpoints
 */
function generateAPIEndpoints() {
  const mermaidCode = `graph TB
    subgraph Auth["Authentication Endpoints"]
        A1[POST /api/v1/auth/register]
        A2[GET /api/v1/auth/activate]
        A3[POST /api/v1/auth/login]
        A4[POST /api/v1/auth/logout]
        A5[POST /api/v1/auth/send-otp]
        A6[POST /api/v1/auth/reset-password]
    end

    subgraph Users["User Management"]
        U1[GET /api/v1/users/all]
        U2[POST /api/v1/users/detail]
        U3[POST /api/v1/users/create]
        U4[PATCH /api/v1/users/edit]
        U5[DELETE /api/v1/users/delete]
        U6[POST /api/v1/users/role-update]
    end

    subgraph Tenants["Tenant Management"]
        T1[GET /api/v1/tenants/all]
        T2[POST /api/v1/tenants/detail]
        T3[POST /api/v1/tenants/create]
        T4[PATCH /api/v1/tenants/edit]
        T5[DELETE /api/v1/tenants/delete]
        T6[POST /api/v1/tenants/settings]
    end

    subgraph Permissions["Permission Management"]
        P1[GET /api/v1/permissions/all]
        P2[POST /api/v1/permissions/create]
        P3[PATCH /api/v1/permissions/edit]
        P4[DELETE /api/v1/permissions/delete]
    end

    subgraph TablePerm["Table Permissions"]
        TP1[GET /api/v1/table-permissions/models]
        TP2[POST /api/v1/table-permissions/permissions/upsert]
        TP3[POST /api/v1/table-permissions/check]
    end

    subgraph Backups["Tenant Backups"]
        B1[POST /api/v1/tenants/backups]
        B2[GET /api/v1/tenants/backups]
        B3[GET /api/v1/tenants/backups/download]
        B4[POST /api/v1/tenants/backups/restore]
        B5[GET /api/v1/tenants/backups/stats]
    end

    subgraph Internal["Internal Endpoints"]
        I1[POST /api/v1/migration/run]
        I2[GET /api/v1/migration/status]
    end
`;

  return generateMermaidSVG("06-api-endpoints.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 07 - Multi-Tenancy Architecture
 */
function generateMultiTenancy() {
  const mermaidCode = `erDiagram
    TENANTS {
        uuid id PK
        string name
        string code
        string status
    }

    TENANT_SETTINGS {
        uuid id PK
        uuid tenantId FK
        string settingKey
        text settingValue
    }

    TENANT_ROLES {
        uuid id PK
        uuid tenantId FK
        string name
    }

    USERS {
        uuid id PK
        uuid tenantId FK
        uuid tenantRoleId FK
        string email
    }

    TENANT_FEATURES {
        uuid id PK
        uuid tenantId FK
        string featureKey
        boolean isEnabled
    }

    TENANT_AUDIT_LOG {
        uuid id PK
        uuid tenantId FK
        uuid userId FK
        string action
    }

    TENANT_BACKUP {
        uuid id PK
        uuid tenantId FK
        string filePath
        string status
    }

    TENANTS ||--o{ TENANT_SETTINGS : "has"
    TENANTS ||--o{ TENANT_ROLES : "defines"
    TENANTS ||--o{ USERS : "contains"
    TENANTS ||--o{ TENANT_FEATURES : "has"
    TENANTS ||--o{ TENANT_AUDIT_LOG : "records"
    TENANTS ||--o{ TENANT_BACKUP : "has"
`;

  return generateMermaidSVG("07-multi-tenancy.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 08 - Backup & Logging System
 */
function generateBackupLogging() {
  const mermaidCode = `sequenceDiagram
    participant Scheduler as Cron Scheduler
    participant Backup as Backup Service
    participant DB as PostgreSQL
    participant Zip as Zip Archive
    participant Storage as File Storage
    participant Logger as Activity Logger
    participant Cleanup as Cleanup Service

    Scheduler->>Backup: Daily backup trigger
    Backup->>DB: Export tenant data
    DB-->>Backup: Data dump
    Backup->>Zip: Create zip archive
    Zip-->>Backup: Backup file
    Backup->>Storage: Save backup
    Storage-->>Backup: File path
    Backup->>Logger: Log backup event
    
    Scheduler->>Cleanup: Weekly cleanup
    Cleanup->>Storage: Check expiration
    Storage-->>Cleanup: Expired files
    Cleanup->>Storage: Delete old backups
    Cleanup->>Logger: Log cleanup event
`;

  return generateMermaidSVG("08-backup-logging.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 09 - Security Layers
 */
function generateSecurityLayers() {
  const mermaidCode = `graph TB
    subgraph L1["Layer 1: Rate Limiting"]
        R1[Auth Limiter<br/>100/hour]
        R2[OTP Limiter<br/>5/hour]
        R3[Global Limiter<br/>1000/15min]
    end

    subgraph L2["Layer 2: Input Validation"]
        V1[Schema Validation]
        V2[Global Sanitizer]
        V3[File Upload Validation]
    end

    subgraph L3["Layer 3: Authentication"]
        A1[JWT Verification]
        A2[Session Validation]
        A3[Email Verification]
    end

    subgraph L4["Layer 4: Authorization"]
        RBAC[RBAC<br/>Role-Based]
        ABAC[ABAC<br/>Attribute-Based]
        TS[Tenant Scope<br/>Isolation]
    end

    subgraph L5["Layer 5: Audit"]
        AL[Activity Logger]
        LL[Login Logs]
        TAL[Tenant Audit Log]
    end

    R1 --> V1
    R2 --> V1
    R3 --> V1
    V1 --> V2
    V2 --> V3
    V3 --> A1
    A1 --> A2
    A2 --> A3
    A3 --> RBAC
    RBAC --> ABAC
    ABAC --> TS
    TS --> AL
    AL --> LL
    LL --> TAL
`;

  return generateMermaidSVG("09-security-layers.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 10 - Project Structure
 */
function generateProjectStructure() {
  const mermaidCode = `graph TB
    Root[boilerplate-pg-mysql/]
    
    subgraph Src[src/]
        Config[config/<br/>connection.js<br/>index.js]
        Controllers[controllers/<br/>auth<br/>tenant<br/>user<br/>permission]
        Middlewares[middlewares/<br/>auth<br/>rbac<br/>abac<br/>tenant*]
        Services[services/<br/>auth<br/>tenant<br/>backup<br/>feature]
        Models[models/<br/>user<br/>tenant<br/>permission<br/>role]
        Routes[routes/<br/>api/<br/>internal/]
        Validators[validators/<br/>auth<br/>tenant<br/>user]
        Utils[utils/<br/>jwt<br/>password<br/>session]
        Templates[templates/<br/>email HTML]
        Tests[tests/<br/>services/<br/>utils/]
    end

    subgraph RootFiles[Root Files]
        Index[index.js]
        Package[package.json]
        Docker[Dockerfile]
        Compose[docker-compose.yaml]
        Swagger[swagger.json]
        Env[local.env]
        Readme[README.md]
        Jest[jest.config.js]
    end

    subgraph Data[Data Directories]
        Uploads[uploads/<br/>tenant/<br/>profile/]
        Backups[backups/<br/>tenant-backups/]
    end

    Root --> Src
    Root --> RootFiles
    Root --> Data
    
    Src --> Config
    Src --> Controllers
    Src --> Middlewares
    Src --> Services
    Src --> Models
    Src --> Routes
    Src --> Validators
    Src --> Utils
    Src --> Templates
    Src --> Tests
`;

  return generateMermaidSVG("10-project-structure.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 12 - Menu Group Architecture
 */
function generateMenuGroupArchitecture() {
  const mermaidCode = `erDiagram
    MENU_GROUPS {
        uuid id PK
        string name
        string description
        string icon
        string color
        int sort_order
        boolean is_active
    }

    MENU_ITEMS {
        uuid id PK
        uuid menuGroupId FK
        string name
        string path
        string icon
        int sort_order
        boolean is_active
    }

    MENU_GROUP_ROLES {
        uuid id PK
        uuid menuGroupId FK
        uuid roleId FK
        uuid createdBy FK
    }

    USER_MENU_GRANTS {
        uuid id PK
        uuid userId FK
        uuid menuGroupId FK
        uuid menuItemId FK
        string grantType
        boolean is_active
    }

    USERS {
        uuid id PK
        string email
        uuid roleId FK
    }

    ROLES {
        uuid id PK
        string name
        int roleLevel
    }

    MENU_GROUPS ||--o{ MENU_ITEMS : "has"
    MENU_GROUPS ||--o{ MENU_GROUP_ROLES : "assigned to"
    USERS ||--o{ USER_MENU_GRANTS : "has"
    USERS }o--|| ROLES : "belongs to"

    MENU_GROUP_ROLES }o--|| ROLES : "references"
    MENU_GROUP_ROLES }o--|| MENU_GROUPS : "references"

    USER_MENU_GRANTS }o--|| MENU_GROUPS : "references"
    USER_MENU_GRANTS }o--|| MENU_ITEMS : "references (optional)"
`;

  return generateMermaidSVG("15-menu-group-architecture.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 13 - User Menu Resolution Flow
 */
function generateUserMenuResolution() {
  const mermaidCode = `flowchart TD
    subgraph Auth["Authentication"]
        A[User Login] --> B{SUPER_ADMIN?}
    end

    subgraph SuperAdmin["Super Admin Path"]
        B -->|Yes| C[Get ALL Menu Groups]
        C --> D[Include ALL Menu Items]
    end

    subgraph RegularUser["Regular User Path"]
        B -->|No| E[Query user_menu_grants]
        E --> F{Has menu-group grant?}
        F -->|Yes| G[Include Entire Group]
        F -->|No| H{Has menu-item grant?}
        H -->|Yes| I[Include Specific Items]
        H -->|No| J[No Access]
    end

    subgraph Merge["Result"]
        D --> K[Merge & Sort]
        G --> K
        I --> K
        K --> L[Return Menu Tree]
    end

    style C fill:#90f
    style K fill:#9f9
    style L fill:#0f0
`;

  return generateMermaidSVG("16-user-menu-resolution.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * 11 - Docker Architecture
 */
function generateDockerArchitecture() {
  const mermaidCode = `graph TB
    subgraph Docker["Docker Network"]
        subgraph Backend["Backend Service"]
            Node[Node.js/Express<br/>Port: 3000]
            Volumes[Volumes:<br/>/app/uploads<br/>/app/backup<br/>/app/log]
        end

        subgraph Postgres["PostgreSQL"]
            PG[postgres:17-alpine<br/>Port: 5432]
            PGData[./data/postgres]
        end

        subgraph Redis["Redis"]
            RDS[redis:8.6-alpine<br/>Port: 6379]
            RDSData[./data/redis]
        end

        subgraph RabbitMQ["RabbitMQ"]
            RMQ[rabbitmq:3.13-mgmt<br/>Port: 5672/15672]
            RMQData[./data/rabbitmq]
        end

        subgraph PgAdmin["pgAdmin"]
            PA[dpage/pgadmin4<br/>Port: 8888]
            PAData[./data/pgadmin]
        end
    end

    subgraph Host["Host Machine"]
        HostUploads[./uploads]
        HostBackups[./backup]
        HostLog[./log]
    end

    Node --> Volumes
    Volumes --> HostUploads
    Volumes --> HostBackups
    Volumes --> HostLog
    PG --> PGData
    RDS --> RDSData
    RMQ --> RMQData
    PA --> PAData
    
    Node -.->|depends_on| PG
    Node -.->|depends_on| RDS
    Node -.->|depends_on| RMQ
    PA -.->|depends_on| PG
`;

  return generateMermaidSVG("11-docker-architecture.svg", mermaidCode, {
    theme: "default",
  });
}

/**
 * Main execution
 */
async function generateAll() {
  console.log("=== Mermaid SVG Generator ===\n");

  const generators = [
    { name: "01-system-architecture.svg", fn: generateSystemArchitecture },
    { name: "02-authentication-flow.svg", fn: generateAuthenticationFlow },
    { name: "03-rbac-abac.svg", fn: generateRBACABAC },
    { name: "04-database-schema.svg", fn: generateDatabaseSchema },
    { name: "05-middleware-pipeline.svg", fn: generateMiddlewarePipeline },
    { name: "06-api-endpoints.svg", fn: generateAPIEndpoints },
    { name: "07-multi-tenancy.svg", fn: generateMultiTenancy },
    { name: "08-backup-logging.svg", fn: generateBackupLogging },
    { name: "09-security-layers.svg", fn: generateSecurityLayers },
    { name: "10-project-structure.svg", fn: generateProjectStructure },
    { name: "11-docker-architecture.svg", fn: generateDockerArchitecture },
    {
      name: "15-menu-group-architecture.svg",
      fn: generateMenuGroupArchitecture,
    },
    { name: "16-user-menu-resolution.svg", fn: generateUserMenuResolution },
  ];

  let success = 0;
  let failed = 0;

  for (const { name, fn } of generators) {
    try {
      const result = await fn();
      if (result) {
        success++;
      } else {
        console.error(`Failed: ${name}`);
        failed++;
      }
    } catch (error) {
      console.error(`Error generating ${name}:`, error.message);
      failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Success: ${success}/${generators.length}`);
  console.log(`Failed: ${failed}/${generators.length}`);
  console.log(`\nOutput directory: ${ILLUSTRATIONS_DIR}`);
}

generateAll().catch(console.error);

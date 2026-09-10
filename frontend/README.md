# Hospital Device Callibrator

A Next.js enterprise-grade frontend application for Hospital Device Calibration Management. This project follows OpenAPI 3.0.0 specification for API integration and implements a modular architecture with Zustand state management.

## Tech Stack

- **Framework**: [Next.js 16.2.6](https://nextjs.org) (App Router)
- **Language**: TypeScript
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **HTTP Client**: [Axios](https://axios-http.com)
- **UI Components**: Tailwind CSS v4
- **Testing**: [Jest](https://jestjs.io) + [Testing Library](https://testing-library.com/)
- **API Documentation**: OpenAPI 3.0.0 (Swagger)

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, pnpm, or bun

### Installation

```bash
npm install
```

### Environment Setup

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

```
├── src/
│   ├── api/
│   │   ├── client.ts                 # Axios instance with interceptors
│   │   └── services/                  # API service modules
│   │       ├── auth.service.ts        # Authentication endpoints
│   │       ├── user.service.ts        # User management endpoints
│   │       ├── role.service.ts        # Role management endpoints
│   │       ├── permission.service.ts  # Permission management endpoints
│   │       ├── tenant.service.ts      # Tenant management endpoints
│   │       ├── device.service.ts      # Device management endpoints
│   │       ├── calibration.service.ts # Calibration endpoints
│   │       ├── vendor.service.ts      # Vendor management endpoints
│   │       ├── maintenance.service.ts # Work order endpoints
│   │       ├── billing.service.ts     # Billing & subscription endpoints
│   │       ├── notification.service.ts# Websocket notification endpoints
│   │       └── audit.service.ts       # Audit trail endpoints
│   ├── app/
│   │   ├── layout.tsx                 # Root layout
│   │   ├── page.tsx                   # Home page
│   │   ├── login/                     # Login page
│   │   ├── dashboard/                 # Dashboard pages
│   │   └── ...
│   ├── components/
│   │   ├── layouts/                   # Layout components
│   │   └── ui/                        # Reusable UI components
│   ├── constants/                     # Application constants
│   ├── stores/                        # Zustand stores
│   │   ├── authStore.ts               # Authentication state
│   │   ├── userStore.ts               # User state
│   │   ├── roleStore.ts               # Role state
│   │   ├── tenantStore.ts             # Tenant state
│   │   └── permissionStore.ts         # Permission state
│   ├── types/                         # TypeScript type definitions
│   └── utils/                         # Utility functions
├── swagger.json                       # OpenAPI specification
├── jest.config.js                     # Jest configuration
└── package.json
```

## API Integration

### OpenAPI Specification

This project uses [swagger.json](swagger.json) as the source of truth for API contracts. The specification follows OpenAPI 3.0.0 standard.

### API Response Format

All API responses follow the standardized format defined in the Swagger spec:

```json
{
  "success": true,
  "status": 200,
  "message": "Operation successful",
  "data": { ... },
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  },
  "token": "jwt-token-here",
  "session": {
    "id": "session-uuid",
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-01-02T00:00:00Z"
  }
}
```

### Available Endpoints

#### Authentication (`/api/v1/auth`)

| Method | Endpoint                            | Description                 | Auth Required |
| ------ | ----------------------------------- | --------------------------- | ------------- |
| POST   | `/api/v1/auth/register`             | Register new user           | No            |
| POST   | `/api/v1/auth/login`                | Login user                  | No            |
| POST   | `/api/v1/auth/logout`               | Logout session              | Yes           |
| POST   | `/api/v1/auth/logout-all`           | Logout all sessions         | Yes           |
| POST   | `/api/v1/auth/verify`               | Verify session              | Yes           |
| POST   | `/api/v1/auth/send-otp`             | Send OTP for password reset | No            |
| POST   | `/api/v1/auth/reset-password`       | Reset password with OTP     | No            |
| POST   | `/api/v1/auth/just-update-password` | Update password             | Yes           |
| POST   | `/api/v1/auth/pass-is-valid`        | Verify password             | Yes           |
| GET    | `/api/v1/auth/activation`           | Activate account            | No            |

#### Users (`/api/v1/users`)

| Method | Endpoint                       | Description                 | Auth Required |
| ------ | ------------------------------ | --------------------------- | ------------- |
| GET    | `/api/v1/users/all`            | Get all users (paginated)   | Yes           |
| POST   | `/api/v1/users/detail`         | Get user by ID              | Yes           |
| POST   | `/api/v1/users/create`         | Create user                 | Yes           |
| PATCH  | `/api/v1/users/edit`           | Update user                 | Yes           |
| DELETE | `/api/v1/users/delete`         | Delete user                 | Yes           |
| POST   | `/api/v1/users/role-update`    | Update user role            | Yes           |
| POST   | `/api/v1/users/username-check` | Check username availability | Yes           |
| POST   | `/api/v1/users/:id/avatar`     | Upload avatar               | Yes           |
| DELETE | `/api/v1/users/:id/avatar`     | Delete avatar               | Yes           |

#### Roles (`/api/v1/roles`)

| Method | Endpoint               | Description               | Auth Required |
| ------ | ---------------------- | ------------------------- | ------------- |
| GET    | `/api/v1/roles/all`    | Get all roles (paginated) | Yes           |
| POST   | `/api/v1/roles/detail` | Get role by ID            | Yes           |
| POST   | `/api/v1/roles/create` | Create role               | Yes           |
| PATCH  | `/api/v1/roles/edit`   | Update role               | Yes           |
| DELETE | `/api/v1/roles/delete` | Delete role               | Yes           |

#### Permissions (`/api/v1/permissions`)

| Method | Endpoint                     | Description          | Auth Required |
| ------ | ---------------------------- | -------------------- | ------------- |
| GET    | `/api/v1/permissions/all`    | Get all permissions  | Yes           |
| POST   | `/api/v1/permissions/detail` | Get permission by ID | Yes           |
| POST   | `/api/v1/permissions/create` | Create permission    | Yes           |
| PATCH  | `/api/v1/permissions/edit`   | Update permission    | Yes           |
| DELETE | `/api/v1/permissions/delete` | Delete permission    | Yes           |

#### Tenants (`/api/v1/tenants`)

| Method | Endpoint                      | Description                 | Auth Required |
| ------ | ----------------------------- | --------------------------- | ------------- |
| GET    | `/api/v1/tenants/all`         | Get all tenants (paginated) | Yes           |
| POST   | `/api/v1/tenants/detail`      | Get tenant by ID            | Yes           |
| POST   | `/api/v1/tenants/create`      | Create tenant               | Yes           |
| PATCH  | `/api/v1/tenants/edit`        | Update tenant               | Yes           |
| DELETE | `/api/v1/tenants/delete`      | Delete tenant               | Yes           |
| POST   | `/api/v1/tenants/settings`    | Get/Update tenant settings  | Yes           |
| POST   | `/api/v1/tenants/user-count`  | Get user count              | Yes           |
| POST   | `/api/v1/tenants/:id/logo`    | Upload logo                 | Yes           |
| DELETE | `/api/v1/tenants/:id/logo`    | Delete logo                 | Yes           |
| POST   | `/api/v1/tenants/:id/backups` | Create backup               | Yes           |

#### Devices (`/api/v1/devices`)

| Method | Endpoint                               | Description                 | Auth Required |
| ------ | -------------------------------------- | --------------------------- | ------------- |
| GET    | `/api/v1/devices/all`                  | Get all devices (paginated) | Yes           |
| POST   | `/api/v1/devices/detail`               | Get device by ID            | Yes           |
| POST   | `/api/v1/devices/create`               | Create device               | Yes           |
| PATCH  | `/api/v1/devices/edit`                 | Update device               | Yes           |
| DELETE | `/api/v1/devices/delete`               | Delete device               | Yes           |
| POST   | `/api/v1/devices/schedule-calibration` | Schedule calibration        | Yes           |
| POST   | `/api/v1/devices/status`               | Get device status           | Yes           |

#### Calibrations (`/api/v1/calibrations`)

| Method | Endpoint                      | Description                      | Auth Required |
| ------ | ----------------------------- | -------------------------------- | ------------- |
| GET    | `/api/v1/calibrations/all`    | Get all calibrations (paginated) | Yes           |
| POST   | `/api/v1/calibrations/detail` | Get calibration by ID            | Yes           |
| GET    | `/api/v1/calibrations/device` | Get calibrations by device       | Yes           |
| POST   | `/api/v1/calibrations/create` | Create calibration               | Yes           |
| PATCH  | `/api/v1/calibrations/edit`   | Update calibration               | Yes           |
| DELETE | `/api/v1/calibrations/delete` | Delete calibration               | Yes           |
| PATCH  | `/api/v1/calibrations/status` | Update status                    | Yes           |

#### Table Permissions (`/api/v1/table-permissions`)

| Method | Endpoint                                       | Description              | Auth Required |
| ------ | ---------------------------------------------- | ------------------------ | ------------- |
| GET    | `/api/v1/table-permissions/models`             | Get all models           | Yes           |
| POST   | `/api/v1/table-permissions/models/detail`      | Get model by ID          | Yes           |
| POST   | `/api/v1/table-permissions/models`             | Create model             | Yes           |
| PATCH  | `/api/v1/table-permissions/models`             | Update model             | Yes           |
| DELETE | `/api/v1/table-permissions/models`             | Delete model             | Yes           |
| POST   | `/api/v1/table-permissions/permissions/detail` | Get table permissions    | Yes           |
| POST   | `/api/v1/table-permissions/permissions/upsert` | Upsert table permissions | Yes           |
| PATCH  | `/api/v1/table-permissions/permissions`        | Update table permission  | Yes           |
| DELETE | `/api/v1/table-permissions/permissions`        | Delete table permission  | Yes           |
| POST   | `/api/v1/table-permissions/check`              | Check permission         | Yes           |
| POST   | `/api/v1/table-permissions/allowed-attributes` | Get allowed attributes   | Yes           |

#### Kanban (`/api/v1/kanban`)

Powers the Kanban board (`/dashboard/kanban`, `/dashboard/kanban/[projectId]`) and the KPI analytics dashboard (`/dashboard/kanban/[projectId]/dashboard`). One project is one board — configurable columns, cards, sprints, labels, and per-project members — with real-time updates over Socket.IO (room `board_<projectId>`).

| Method | Endpoint                                | Description                              | Auth Required |
| ------ | --------------------------------------- | ---------------------------------------- | ------------- |
| GET    | `/api/v1/kanban/projects`               | List boards                              | Yes           |
| POST   | `/api/v1/kanban/projects`               | Create board                            | Yes           |
| GET    | `/api/v1/kanban/projects/:id`           | Board detail (columns, cards, members)   | Yes           |
| POST   | `/api/v1/kanban/projects/:id/cards`     | Create card (auto card key, e.g. `MGT-1`)| Yes           |
| PATCH  | `/api/v1/kanban/projects/:id/cards/:cardId/move` | Move card between columns        | Yes           |
| POST   | `/api/v1/kanban/projects/:id/sprints`   | Manage sprints                          | Yes           |
| POST   | `/api/v1/kanban/projects/:id/sprints/migrate` | Migrate cards to a sprint          | Yes           |
| GET    | `/api/v1/kanban/projects/:id/metrics`   | KPI analytics dashboard aggregates       | Yes           |

## State Management

### Auth Store (`authStore.ts`)

Manages authentication state using Zustand:

```typescript
const { user, isAuthenticated, isLoading, error } = useAuthStore();

// Login
await useAuthStore.getState().login(username, password);

// Logout
await useAuthStore.getState().logout();

// Initialize (verify token on mount)
await useAuthStore.getState().initialize();
```

## Testing

### Run Tests

```bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
npm test -- --coverage # With coverage report
```

### Test Files

| File                                          | Description                  |
| --------------------------------------------- | ---------------------------- |
| `src/api/services/auth.service.test.ts`       | Authentication service tests |
| `src/api/services/user.service.test.ts`       | User service tests           |
| `src/api/services/role.service.test.ts`       | Role service tests           |
| `src/api/services/permission.service.test.ts` | Permission service tests     |
| `src/api/services/tenant.service.test.ts`     | Tenant service tests         |
| `src/stores/authStore.test.ts`                | Auth store tests             |

## Components

### UI Components

Located in `src/components/ui/`:

- `Alert` - Alert/notification component
- `Badge` - Badge component
- `Button` - Button component
- `Card` - Card component
- `Input` - Input component
- `Select` - Select component
- `Table` - Table component
- `Textarea` - Textarea component

### Layouts

- `DashboardLayout` - Main dashboard layout with sidebar navigation
- `LandingLayout` - Landing page layout

## Environment Variables

| Variable                   | Description          | Default                 |
| -------------------------- | -------------------- | ----------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Backend API base URL | `http://localhost:5000` |

## Build & Deployment

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
```

### Start Production Server

```bash
npm start
```

### Lint

```bash
npm run lint
```

## API Client Configuration

The API client is configured in [`src/api/client.ts`](src/api/client.ts):

- Base URL from `API_BASE_URL` constant
- 30-second timeout
- Automatic JWT token injection via `Authorization: Bearer <token>` header
- Session token in `X-Session` header
- Automatic redirect to login on 401 errors

## License

MIT

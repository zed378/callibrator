// Common types for Device Calibrator
import type { components } from "@/api/generated/schema";
import type { TenantLifecycleStatus } from "@callibrator/contracts/states";
// Simplified RBAC with permission (read/write) model

/**
 * P9-25 (ADR-103 item 11): a role row is the contract's (roles.openapi.ts,
 * RoleRow); `isActive` is derived from `status` by role.service (F-19).
 */
export type Role = components["schemas"]["RoleRow"] & { isActive?: boolean };

/**
 * The role a user row carries: the list's projection (`id`, `name`,
 * `nameToShow`, `description`) and the session's role, so every other role
 * field is optional.
 */
export type UserRole = Pick<Role, "id" | "name"> & Partial<Omit<Role, "id" | "name">>;

export interface User {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  first_name?: string;
  last_name?: string;
  email: string;
  roleId?: string;
  tenantId?: string | null;
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "PENDING";
  picture?: string;
  avatarUrl?: string;
  role?: UserRole;
  createdAt?: string;
  updatedAt?: string;
  // A-141: from /auth/verify and the MFA sign-in step. A count, never a code.
  mfaEnabled?: boolean;
  mfaRecoveryCodesRemaining?: number;
  // A-262: from the users list — the page offers "Remove passkey" only here.
  webauthnEnabled?: boolean;
  // A-123: an administrator set this account's password; it must be changed
  // before anything else (the backend answers 403 PASSWORD_CHANGE_REQUIRED).
  mustChangePassword?: boolean;
  // A-160: the user's tenant requires MFA and this account has none; from
  // /auth/verify. The backend answers 403 MFA_ENROLMENT_REQUIRED elsewhere.
  mfaEnrolmentRequired?: boolean;
  // A-216: this session signed in through the organisation's identity
  // provider, which manages the password; from /auth/verify. The
  // change-password page explains instead of showing the form.
  passwordManagedBy?: { protocol: string; provider: string | null } | null;
}

/** A-288 (ADR-100): the device position a geofenced tenant asks for. */
export interface SignInLocation {
  latitude: number;
  longitude: number;
}

export interface LoginCredentials {
  user: string;
  password: string;
  /** Sent only after the backend answered 403 LOCATION_REQUIRED. */
  location?: SignInLocation;
}

export interface RegisterCredentials {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  data: User;
}

// Backend login response structure (actual API response)
export interface BackendLoginResponse {
  success: boolean;
  status: number;
  message: string;
  data: User;
  token: string;
  session: {
    id: string;
    createdAt: string;
    expiresAt?: string;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message?: string;
  data: T[];
  meta: {
    total?: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface Tenant {
  id: string;
  name: string;
  code: string;
  description?: string;
  logo?: string;
  logoBaseUrl?: string;
  primaryColor?: string;
  /**
   * A-361: the model's lower-case lifecycle ENUM, as the API answers it
   * (`tenants.status`; @callibrator/contracts/states). It was typed in upper
   * case, which no answer ever carries, so the tenants page's counts and badges
   * never matched.
   */
  status: TenantLifecycleStatus;
  /** The seat limit (platform-set). null or negative = unlimited. `maxUsers` never existed on the backend. */
  limitSeats?: number | null;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  website?: string;
  settings?: TenantSettings;
  users?: User[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  sso_enabled?: boolean | string;
  sso_idp_entry_point?: string;
  sso_idp_entity_id?: string;
  sso_idp_cert?: string;
  sso_sp_entity_id?: string;
  sso_sp_callback_url?: string;
  [key: string]: unknown;
}

export interface TenantSettingsResponse {
  tenant: Tenant;
  settings: TenantSettings;
}

// ==========================================
// Menu Group Types
// ==========================================

export interface MenuItem {
  id?: string;
  label: string;
  path: string;
  icon: string;
  requiredPermission?: string;
  isAssigned?: boolean;
}

export interface MenuGroup {
  id?: string;
  label: string;
  icon: string;
  path?: string;
  items?: MenuItem[];
  sortOrder?: number;
  isAssigned?: boolean;
}

export interface MenuGroupAssignment {
  id: string;
  menuGroupId: string;
  menuGroup?: {
    label: string;
    icon: string;
    path?: string;
    items?: MenuItem[];
  };
  role?: {
    id: string;
    name: string;
    nameToShow: string;
    roleLevel: number;
  };
  notes?: string;
  assignedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MenuGroupAssignmentResponse {
  success: boolean;
  data: MenuGroupAssignment;
  message?: string;
}

export interface BulkAssignmentResult {
  assigned: string[];
  alreadyAssigned: string[];
  failed: { menuGroupId: string; error: string }[];
}

export interface BulkRevokeResult {
  revoked: string[];
  notFound: string[];
}

// ==========================================
// Device & Calibration Types (Unchanged)
// ==========================================

export interface Device {
  id: string;
  name: string;
  type: string;
  location: string;
  status: "active" | "inactive" | "maintenance" | "calibration_due";
  lastCalibration?: string;
  nextCalibration?: string;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Calibration {
  id: string;
  deviceId: string;
  deviceName: string;
  technician: string;
  date: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  results?: Record<string, unknown>;
  notes?: string;
  scheduledDate?: string;
  completedDate?: string;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Warehouse & Inventory Types (Phase 2)
// ==========================================

/**
 * P9-25 (ADR-103 item 11): the contract's own schemas
 * (backend/src/routes/api/warehouse.openapi.ts), replacing the hand-written
 * copies. A warehouse is "active" or "inactive" (WAREHOUSE_STATUSES; A-355: the
 * form offered "suspended", which the API refuses); a list row carries no
 * `locations`.
 */
export type Warehouse = components["schemas"]["Warehouse"] & {
  locations?: StorageLocation[];
};

/** A warehouse status the API accepts. The column is nullable (default "active"). */
export type WarehouseStatus = NonNullable<Warehouse["status"]>;

export type StorageLocation = components["schemas"]["StorageLocation"];

// P9-25 (ADR-103 item 11): the stock rows are the contract's
// (@callibrator/contracts/stock). A list or single read carries the joins
// (the `*ListItem` / `StockDetail` schemas); a write's answer is the bare row.
type StockSchemas = components["schemas"];
export type Stock = StockSchemas["Stock"] & Partial<Pick<StockSchemas["StockDetail"], "warehouse" | "location">>;
export type StockTransfer = StockSchemas["StockTransfer"] &
  Partial<Pick<StockSchemas["StockTransferListItem"], "fromWarehouse" | "toWarehouse" | "requester" | "approver" | "apiKey">>;
export type StockAdjustment = StockSchemas["StockAdjustment"] &
  Partial<Pick<StockSchemas["StockAdjustmentListItem"], "warehouse" | "adjuster" | "apiKey">>;
export type StockOpname = StockSchemas["StockOpname"] &
  Partial<Pick<StockSchemas["StockOpnameListItem"], "warehouse" | "performer">>;

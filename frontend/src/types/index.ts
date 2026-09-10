// Common types for Hospital Device Callibrator
// Simplified RBAC with permission (read/write) model

export interface Role {
  id: string;
  name: string;
  description?: string;
  nameToShow?: string;
  isActive?: boolean;
  roleLevel?: number;
  createdAt?: string;
  updatedAt?: string;
}

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
  role?: Role;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoginCredentials {
  user: string;
  password: string;
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
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  maxUsers: number;
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

export interface Warehouse {
  id: string;
  tenantId?: string;
  name: string;
  code: string;
  address?: string | null;
  description?: string | null;
  status: "active" | "suspended" | "inactive";
  locations?: StorageLocation[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StorageLocation {
  id: string;
  tenantId?: string;
  warehouseId: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Stock {
  id: string;
  tenantId?: string;
  warehouseId: string;
  locationId?: string | null;
  itemName: string;
  sku?: string | null;
  serialNumber?: string | null;
  quantity: number;
  minQuantity: number;
  description?: string | null;
  warehouse?: { id: string; name: string; code: string };
  location?: { id: string; name: string; code: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface StockTransfer {
  id: string;
  tenantId?: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: "pending" | "in_transit" | "completed" | "cancelled";
  requestedBy: string;
  approvedBy?: string | null;
  itemName: string;
  quantity: number;
  transferDate?: string | null;
  notes?: string | null;
  fromWarehouse?: { id: string; name: string; code: string };
  toWarehouse?: { id: string; name: string; code: string };
  requester?: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
  };
  approver?: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface StockAdjustment {
  id: string;
  tenantId?: string;
  warehouseId: string;
  locationId?: string | null;
  type: "addition" | "subtraction" | "write_off";
  quantity: number;
  reason?: string | null;
  adjustedBy: string;
  warehouse?: { id: string; name: string; code: string };
  adjuster?: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface StockOpname {
  id: string;
  tenantId?: string;
  warehouseId: string;
  status: "draft" | "in_progress" | "completed";
  scheduledAt: string;
  completedAt?: string | null;
  performedBy: string;
  notes?: string | null;
  warehouse?: { id: string; name: string; code: string };
  performer?: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

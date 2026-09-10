// Application constants
import React from "react";
import {
  LayoutGrid,
  User,
  Settings,
  Users,
  Shield,
  Building2,
  Activity,
  Wrench,
  PenTool,
  Key,
} from "lucide-react";

export const APP_NAME = "Hospital Device Callibrator";
export const APP_VERSION = "1.0.0";

// API Configuration
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";
export const API_VERSION = "/api/v1";
export const API_TIMEOUT = 30000; // 30 seconds

// Deploy-time tenant binding. When a single-tenant frontend is deployed with
// NEXT_PUBLIC_TENANT_ID set, the login/register pages fetch that tenant's
// public branding (name/logo/color) BEFORE sign-in, and the proxy sends
// `X-Tenant-ID` on every API call. Empty = default (multi-tenant) build.
export const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || "";
export const HAS_CONFIGURED_TENANT = TENANT_ID.length > 0;

// Auth
export const AUTH_TOKEN_KEY = "auth_token";
export const AUTH_USER_KEY = "auth_user";
export const LOGIN_REDIRECT = "/dashboard";
export const DASHBOARD_PATH = "/dashboard";

// Routes
export const PUBLIC_ROUTES = ["/", "/login"];
export const PROTECTED_ROUTES = ["/dashboard"];

// Dashboard menu items
export interface MenuItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  /** Required table permission: modelName:action (e.g., 'User:read') */
  requiredPermission?: string;
}

export interface MenuGroup {
  label: string;
  icon: React.ReactNode;
  path?: string;
  children?: MenuGroup[];
  items?: MenuItem[];
  /** Required table permission for the group itself */
  requiredPermission?: string;
}

export const DASHBOARD_MENU: MenuGroup[] = [
  {
    label: "Home",
    icon: React.createElement(LayoutGrid, { className: "w-5 h-5" }),
    path: "/dashboard",
  },
  {
    label: "Dashboard",
    icon: React.createElement(LayoutGrid, { className: "w-5 h-5" }),
    path: "/dashboard",
  },
  {
    label: "Account",
    icon: React.createElement(User, { className: "w-5 h-5" }),
    items: [
      {
        label: "Profile",
        path: "/dashboard/profile",
        icon: React.createElement(User, { className: "w-4 h-4" }),
      },
      {
        label: "Change Password",
        path: "/dashboard/change-password",
        icon: React.createElement(Key, { className: "w-4 h-4" }),
      },
    ],
  },
  {
    label: "Management",
    icon: React.createElement(Settings, { className: "w-5 h-5" }),
    items: [
      {
        label: "Menu Group Assignment",
        path: "/dashboard/menu-groups",
        icon: React.createElement(LayoutGrid, { className: "w-4 h-4" }),
      },
      {
        label: "Tenants",
        path: "/dashboard/tenants",
        icon: React.createElement(Building2, { className: "w-4 h-4" }),
      },
      {
        label: "Roles",
        path: "/dashboard/roles",
        icon: React.createElement(Shield, { className: "w-4 h-4" }),
      },
      {
        label: "Users",
        path: "/dashboard/users",
        icon: React.createElement(Users, { className: "w-4 h-4" }),
      },
    ],
  },
  {
    label: "Equipment",
    icon: React.createElement(Wrench, { className: "w-5 h-5" }),
    items: [
      {
        label: "Calibration Devices",
        path: "/dashboard/devices",
        icon: React.createElement(Wrench, { className: "w-4 h-4" }),
      },
      {
        label: "Calibration & Certificates",
        path: "/dashboard/calibration",
        icon: React.createElement(PenTool, { className: "w-4 h-4" }),
      },
    ],
  },
  {
    label: "Security",
    icon: React.createElement(Shield, { className: "w-5 h-5" }),
    items: [
      {
        label: "Session Management",
        path: "/dashboard/session-management",
        icon: React.createElement(Activity, { className: "w-4 h-4" }),
      },
    ],
  },
];

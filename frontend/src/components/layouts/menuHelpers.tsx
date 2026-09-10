// src/components/layouts/menuHelpers.tsx
import React from "react";
import {
  LayoutGrid,
  User,
  Settings,
  Users,
  Shield,
  Building2,
  Key,
  Table2,
  Database,
  Monitor,
  Home,
  Warehouse,
  Bell,
  Truck,
  CreditCard,
  ScrollText,
  KeyRound,
  Webhook,
  Wrench,
  CalendarClock,
  BarChart3,
  FileText,
  Newspaper,
  ShieldAlert,
  ClipboardCheck,
  Activity,
  ToggleLeft,
  ArrowLeftRight,
  Trash2,
  Lock,
  Fingerprint,
  Network,
  ClipboardList,
  GitBranch,
  Landmark,
  Gauge,
  Cpu,
  Globe,
  KanbanSquare,
  Ticket,
  TicketPlus,
  TicketCheck,
} from "lucide-react";
import { BackendMenuGroup, BackendMenuItem } from "@/stores/menuStore";

export type MenuItemType = {
  label: string;
  path?: string;
  icon: React.ReactNode;
  requiredPermission?: string;
  // Present on sub-group categories, which render as a collapsible row with
  // their own children nested one level deeper.
  items?: MenuItemType[];
};

export type MenuGroupType = {
  label: string;
  icon: React.ReactNode;
  path?: string;
  items?: MenuItemType[];
};

export const iconMap: Record<string, React.ReactNode> = {
  LayoutGrid: React.createElement(LayoutGrid, { className: "w-5 h-5" }),
  User: React.createElement(User, { className: "w-5 h-5" }),
  Settings: React.createElement(Settings, { className: "w-5 h-5" }),
  Users: React.createElement(Users, { className: "w-5 h-5" }),
  Shield: React.createElement(Shield, { className: "w-5 h-5" }),
  Building2: React.createElement(Building2, { className: "w-5 h-5" }),
  Key: React.createElement(Key, { className: "w-5 h-5" }),
  Table2: React.createElement(Table2, { className: "w-5 h-5" }),
  Database: React.createElement(Database, { className: "w-5 h-5" }),
  Monitor: React.createElement(Monitor, { className: "w-5 h-5" }),
  Home: React.createElement(Home, { className: "w-5 h-5" }),
  Warehouse: React.createElement(Warehouse, { className: "w-5 h-5" }),
  Bell: React.createElement(Bell, { className: "w-5 h-5" }),
  Truck: React.createElement(Truck, { className: "w-5 h-5" }),
  CreditCard: React.createElement(CreditCard, { className: "w-5 h-5" }),
  ScrollText: React.createElement(ScrollText, { className: "w-5 h-5" }),
  KeyRound: React.createElement(KeyRound, { className: "w-5 h-5" }),
  Webhook: React.createElement(Webhook, { className: "w-5 h-5" }),
  Wrench: React.createElement(Wrench, { className: "w-5 h-5" }),
  CalendarClock: React.createElement(CalendarClock, { className: "w-5 h-5" }),
  BarChart3: React.createElement(BarChart3, { className: "w-5 h-5" }),
  FileText: React.createElement(FileText, { className: "w-5 h-5" }),
  Newspaper: React.createElement(Newspaper, { className: "w-5 h-5" }),
  ShieldAlert: React.createElement(ShieldAlert, { className: "w-5 h-5" }),
  ClipboardCheck: React.createElement(ClipboardCheck, { className: "w-5 h-5" }),
  Activity: React.createElement(Activity, { className: "w-5 h-5" }),
  ToggleLeft: React.createElement(ToggleLeft, { className: "w-5 h-5" }),
  ArrowLeftRight: React.createElement(ArrowLeftRight, { className: "w-5 h-5" }),
  Trash2: React.createElement(Trash2, { className: "w-5 h-5" }),
  Lock: React.createElement(Lock, { className: "w-5 h-5" }),
  Fingerprint: React.createElement(Fingerprint, { className: "w-5 h-5" }),
  Network: React.createElement(Network, { className: "w-5 h-5" }),
  ClipboardList: React.createElement(ClipboardList, { className: "w-5 h-5" }),
  GitBranch: React.createElement(GitBranch, { className: "w-5 h-5" }),
  Landmark: React.createElement(Landmark, { className: "w-5 h-5" }),
  Gauge: React.createElement(Gauge, { className: "w-5 h-5" }),
  Cpu: React.createElement(Cpu, { className: "w-5 h-5" }),
  Globe: React.createElement(Globe, { className: "w-5 h-5" }),
  KanbanSquare: React.createElement(KanbanSquare, { className: "w-5 h-5" }),
  Ticket: React.createElement(Ticket, { className: "w-5 h-5" }),
  TicketPlus: React.createElement(TicketPlus, { className: "w-5 h-5" }),
  TicketCheck: React.createElement(TicketCheck, { className: "w-5 h-5" }),
};

export const smallIconMap: Record<string, React.ReactNode> = {
  LayoutGrid: React.createElement(LayoutGrid, { className: "w-4 h-4" }),
  User: React.createElement(User, { className: "w-4 h-4" }),
  Settings: React.createElement(Settings, { className: "w-4 h-4" }),
  Users: React.createElement(Users, { className: "w-4 h-4" }),
  Shield: React.createElement(Shield, { className: "w-4 h-4" }),
  Building2: React.createElement(Building2, { className: "w-4 h-4" }),
  Key: React.createElement(Key, { className: "w-4 h-4" }),
  Table2: React.createElement(Table2, { className: "w-4 h-4" }),
  Database: React.createElement(Database, { className: "w-4 h-4" }),
  Monitor: React.createElement(Monitor, { className: "w-4 h-4" }),
  Warehouse: React.createElement(Warehouse, { className: "w-4 h-4" }),
  Bell: React.createElement(Bell, { className: "w-4 h-4" }),
  Truck: React.createElement(Truck, { className: "w-4 h-4" }),
  CreditCard: React.createElement(CreditCard, { className: "w-4 h-4" }),
  ScrollText: React.createElement(ScrollText, { className: "w-4 h-4" }),
  KeyRound: React.createElement(KeyRound, { className: "w-4 h-4" }),
  Webhook: React.createElement(Webhook, { className: "w-4 h-4" }),
  Wrench: React.createElement(Wrench, { className: "w-4 h-4" }),
  CalendarClock: React.createElement(CalendarClock, { className: "w-4 h-4" }),
  BarChart3: React.createElement(BarChart3, { className: "w-4 h-4" }),
  FileText: React.createElement(FileText, { className: "w-4 h-4" }),
  Newspaper: React.createElement(Newspaper, { className: "w-4 h-4" }),
  ShieldAlert: React.createElement(ShieldAlert, { className: "w-4 h-4" }),
  ClipboardCheck: React.createElement(ClipboardCheck, { className: "w-4 h-4" }),
  Activity: React.createElement(Activity, { className: "w-4 h-4" }),
  ToggleLeft: React.createElement(ToggleLeft, { className: "w-4 h-4" }),
  ArrowLeftRight: React.createElement(ArrowLeftRight, { className: "w-4 h-4" }),
  Trash2: React.createElement(Trash2, { className: "w-4 h-4" }),
  Lock: React.createElement(Lock, { className: "w-4 h-4" }),
  Fingerprint: React.createElement(Fingerprint, { className: "w-4 h-4" }),
  Network: React.createElement(Network, { className: "w-4 h-4" }),
  ClipboardList: React.createElement(ClipboardList, { className: "w-4 h-4" }),
  GitBranch: React.createElement(GitBranch, { className: "w-4 h-4" }),
  Landmark: React.createElement(Landmark, { className: "w-4 h-4" }),
  Gauge: React.createElement(Gauge, { className: "w-4 h-4" }),
  Cpu: React.createElement(Cpu, { className: "w-4 h-4" }),
  Globe: React.createElement(Globe, { className: "w-4 h-4" }),
  KanbanSquare: React.createElement(KanbanSquare, { className: "w-4 h-4" }),
  Ticket: React.createElement(Ticket, { className: "w-4 h-4" }),
  TicketPlus: React.createElement(TicketPlus, { className: "w-4 h-4" }),
  TicketCheck: React.createElement(TicketCheck, { className: "w-4 h-4" }),
};

// Converts a backend menu item (leaf or sub-group category) recursively so any
// nesting depth the backend returns survives the conversion.
const convertBackendMenuItem = (item: BackendMenuItem): MenuItemType => ({
  label: item.label,
  path: item.path || "",
  icon: smallIconMap[item.icon] || React.createElement(User, {}),
  requiredPermission: item.requiredPermission || undefined,
  items:
    item.items && item.items.length > 0
      ? item.items.map(convertBackendMenuItem)
      : undefined,
});

export const convertBackendMenuToFrontend = (
  groups: BackendMenuGroup[],
): MenuGroupType[] => {
  return groups.map((group) => ({
    label: group.label,
    icon: iconMap[group.icon] || React.createElement(LayoutGrid, {}),
    path: group.path || "",
    items: group.items?.map(convertBackendMenuItem),
  }));
};

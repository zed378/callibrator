// src/components/layouts/Sidebar.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { Shield, ChevronDown, X } from "lucide-react";
import { MenuGroupType, MenuItemType } from "./menuHelpers";
import { LogOut } from "lucide-react";
import Image from "next/image";
import { avatarImageProps } from "@/lib/uploadUrl";

interface SidebarProps {
  pathname: string;
  expandedGroups: string[];
  onToggleExpand: (label: string) => void;
  router: ReturnType<typeof useRouter>;
  isOpen: boolean;
  onClose: () => void;
  filteredMenu: MenuGroupType[];
}

const isPathActive = (path: string | undefined, pathname: string) =>
  !!path && (pathname === path || pathname?.startsWith(path + "/"));

// A leaf entry rendered inside a group (level 2) or a sub-group (level 3).
const SidebarLeaf: React.FC<{ node: MenuItemType; pathname: string }> = ({
  node,
  pathname,
}) => {
  const active = isPathActive(node.path, pathname);
  return (
    <Link
      href={node.path || "#"}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm ${
        active
          ? "text-primary bg-primary/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      <span className="w-4 h-4" />
      {node.icon}
      <span>{node.label}</span>
    </Link>
  );
};

// A sub-group category (level 2) that is collapsible and holds its own items.
const SidebarSubGroup: React.FC<{ node: MenuItemType; pathname: string }> = ({
  node,
  pathname,
}) => {
  const children = node.items || [];
  const hasActiveChild = children.some((child) =>
    isPathActive(child.path, pathname),
  );
  const [isExpanded, setIsExpanded] = useState(hasActiveChild);

  return (
    <div>
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm ${
          hasActiveChild
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="w-4 h-4" />
          {node.icon}
          <span>{node.label}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${
            isExpanded
              ? "rotate-0 text-muted-foreground"
              : "-rotate-90 text-muted-foreground/60"
          }`}
        />
      </button>
      {isExpanded && (
        <div className="ml-3 mt-1 space-y-0.5">
          {children.map((child) => (
            <SidebarLeaf
              key={child.path || child.label}
              node={child}
              pathname={pathname}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  pathname,
  expandedGroups,
  onToggleExpand,
  router,
  isOpen,
  onClose,
  filteredMenu,
}) => {
  const { user, avatarUrl, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const displayName =
    (user?.first_name || user?.firstName) && (user?.last_name || user?.lastName)
      ? `${user.first_name || user.firstName} ${user.last_name || user.lastName}`
      : user?.username || "User";


  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-card backdrop-blur-2xl shadow-lg transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-linear-to-br from-primary to-accent rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                HDC
              </h1>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                Callibrator
              </p>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
          <div className="pt-3 pb-1">
            <p className="px-3 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
              Menu
            </p>
          </div>
          {filteredMenu.map((item) => {
            const isActive =
              item.path &&
              (pathname === item.path || pathname?.startsWith(item.path + "/"));
            const hasChildren = item.items && item.items.length > 0;
            const isExpanded = expandedGroups.includes(item.label);
            return (
              <div key={item.label}>
                {item.path && !hasChildren ? (
                  <Link
                    href={item.path}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                      isActive
                        ? "bg-primary/10 text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {item.icon}
                    </span>
                    <span className="text-sm font-medium">{item.label}</span>
                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </Link>
                ) : (
                  <div>
                    <button
                      onClick={() => onToggleExpand(item.label)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        >
                          {item.icon}
                        </span>
                        <span className="text-sm font-medium">
                          {item.label}
                        </span>
                      </div>
                      {hasChildren && (
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${
                            isExpanded
                              ? "rotate-0 text-muted-foreground"
                              : "-rotate-90 text-muted-foreground/60"
                          }`}
                        />
                      )}
                    </button>
                    {hasChildren && isExpanded && (
                      <div className="ml-3 mt-1 space-y-0.5">
                        {item.items?.map((child) =>
                          child.items && child.items.length > 0 ? (
                            <SidebarSubGroup
                              key={child.path || child.label}
                              node={child}
                              pathname={pathname}
                            />
                          ) : (
                            <SidebarLeaf
                              key={child.path || child.label}
                              node={child}
                              pathname={pathname}
                            />
                          ),
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {/* User Profile */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-muted">
            <Image
              {...avatarImageProps(user?.picture || avatarUrl)}
              alt={displayName}
              width={36}
              height={36}
              className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {displayName}
              </p>
              {user?.email && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {user.email}
                </p>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 cursor-pointer"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;

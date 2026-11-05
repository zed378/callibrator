// src/components/layouts/Sidebar.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { ChevronDown, X } from "lucide-react";
import { MenuGroupType, MenuItemType } from "./menuHelpers";
import { LogOut } from "lucide-react";
import Image from "next/image";
import { avatarImageProps } from "@/lib/uploadUrl";
import { BrandIcon } from "@/components/brand/BrandIcon";

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
      className={`flex items-center gap-2.5 px-2.5 py-2.5 lg:py-1.5 rounded-md transition-colors text-[13px] [&_svg]:size-4 [&_svg]:shrink-0 ${
        active
          ? "text-primary bg-surface-selected font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
      }`}
    >
      {node.icon}
      <span className="truncate">{node.label}</span>
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
        className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 lg:py-1.5 rounded-md transition-colors text-[13px] [&_svg]:size-4 [&_svg]:shrink-0 ${
          hasActiveChild
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {node.icon}
          <span className="truncate">{node.label}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${
            isExpanded
              ? "rotate-0 text-muted-foreground"
              : "-rotate-90 text-muted-foreground"
          }`}
        />
      </button>
      {isExpanded && (
        <div className="ml-[17px] mt-0.5 pl-1.5 border-l border-border space-y-px">
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
          className="fixed inset-0 bg-scrim backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-sidebar border-r border-border shadow-lg lg:shadow-none transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandIcon className="w-8 h-8 shrink-0 text-logo-ink" />
            {/* Q-43 (ADR-098 §8.1): the product is "Device Calibrator"; "Callibrator" is the codename only.
                Not a heading: each page has ONE <h1>, in its <main> (ADR-090). */}
            <p className="text-base font-bold text-foreground tracking-tight leading-tight">
              Device Calibrator
            </p>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation */}
        <nav aria-label="Main" className="flex-1 px-2 py-2 space-y-px overflow-y-auto overflow-x-hidden [&_svg]:size-4 [&_svg]:shrink-0">
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
                    className={`flex items-center gap-2.5 px-2.5 py-2.5 lg:py-1.5 rounded-md transition-colors ${
                      isActive
                        ? "bg-surface-selected text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                    }`}
                  >
                    <span
                      className={`transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {item.icon}
                    </span>
                    <span className="text-[13px] font-medium truncate">{item.label}</span>
                  </Link>
                ) : (
                  <div>
                    <button
                      onClick={() => onToggleExpand(item.label)}
                      className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 lg:py-1.5 rounded-md transition-colors ${
                        isActive
                          ? "bg-surface-selected text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        >
                          {item.icon}
                        </span>
                        <span className="text-[13px] font-medium truncate">
                          {item.label}
                        </span>
                      </div>
                      {hasChildren && (
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${
                            isExpanded
                              ? "rotate-0 text-muted-foreground"
                              : "-rotate-90 text-muted-foreground"
                          }`}
                        />
                      )}
                    </button>
                    {hasChildren && isExpanded && (
                      <div className="ml-[17px] mt-0.5 mb-1 pl-1.5 border-l border-border space-y-px">
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
        <div className="border-t border-border p-2">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
            <Image
              {...avatarImageProps(user?.picture || avatarUrl)}
              alt={displayName}
              width={28}
              height={28}
              className="w-7 h-7 rounded-md object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate leading-tight">
                {displayName}
              </p>
              {user?.email && (
                <p className="text-[11px] text-muted-foreground truncate leading-tight">
                  {user.email}
                </p>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 cursor-pointer"
              title="Logout"
              aria-label="Logout"
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

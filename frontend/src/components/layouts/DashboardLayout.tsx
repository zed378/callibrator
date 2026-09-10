// src/components/layouts/DashboardLayout.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ImpersonationBanner from "./ImpersonationBanner";
import { MenuGroupType, convertBackendMenuToFrontend } from "./menuHelpers";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading, isAuthenticated, user } = useAuthStore();
  const { menuGroups, isMenuLoaded, fetchPersonalizedMenu } = useMenuStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  // Convert backend menu groups from store to frontend format
  const filteredMenu = useMemo<MenuGroupType[]>(() => {
    if (menuGroups.length > 0) {
      return convertBackendMenuToFrontend(menuGroups);
    }
    return [];
  }, [menuGroups]);

  // Fetch personalized menu from backend on mount
  useEffect(() => {
    if (isAuthenticated && !isMenuLoaded) {
      const roleId = user?.roleId;
      if (roleId) {
        fetchPersonalizedMenu(roleId);
      } else {
        fetchPersonalizedMenu();
      }
    }
  }, [isAuthenticated, isMenuLoaded, fetchPersonalizedMenu, user?.roleId]);

  // Handle responsive layout resizing
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(true);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Auto-close sidebar on mobile after route change
  useEffect(() => {
    if (!isMobile) return;
    const timer = setTimeout(() => {
      setSidebarOpen(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, isMobile]);

  const toggleExpand = useCallback((label: string) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    );
  }, []);

  // Auto-expand groups when their submenu is active
  const autoExpandedGroups = useMemo(() => {
    const activeGroups: string[] = [];
    for (const group of filteredMenu) {
      if (group.items) {
        for (const item of group.items) {
          if (
            item.path &&
            (pathname === item.path || pathname?.startsWith(item.path + "/"))
          ) {
            activeGroups.push(group.label);
            break;
          }
        }
      }
    }
    return [...new Set([...expandedGroups, ...activeGroups])];
  }, [pathname, expandedGroups, filteredMenu]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-transparent border-t-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        pathname={pathname || ""}
        expandedGroups={autoExpandedGroups}
        onToggleExpand={toggleExpand}
        router={router}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        filteredMenu={filteredMenu}
      />

      <div
        className={`transition-all duration-300 flex flex-col min-h-screen ${isMobile ? "" : "lg:ml-72"}`}
      >
        <TopBar
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          pathname={pathname || ""}
        />
        <ImpersonationBanner />
        {/* flex-1 fills the viewport below the TopBar exactly — pages always
            reach the bottom of the screen without adding extra scroll. */}
        <main className="flex-1 p-4 sm:p-6 bg-card">{children}</main>
      </div>
    </div>
  );
};

export default DashboardLayout;

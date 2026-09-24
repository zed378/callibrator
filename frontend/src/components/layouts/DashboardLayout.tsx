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
import { CHANGE_PASSWORD_PATH, MFA_PATH } from "@/api/client";
import { useAccessDeniedStore } from "@/stores/accessDeniedStore";
import AccessDeniedModal from "@/components/AccessDeniedModal";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading, isAuthenticated, user } = useAuthStore();
  const { menuGroups, isMenuLoaded, menuError, fetchPersonalizedMenu, clearMenu } =
    useMenuStore();
  const accessDenied = useAccessDeniedStore();

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
  // (F-15: with no roleId the store yields NO menu and an error, never a
  // static fallback tree.)
  const roleId = user?.roleId ?? undefined;
  useEffect(() => {
    if (isAuthenticated && !isMenuLoaded) {
      fetchPersonalizedMenu(roleId);
    }
  }, [isAuthenticated, isMenuLoaded, fetchPersonalizedMenu, roleId]);

  const reloadMenu = useCallback(() => {
    clearMenu();
    void fetchPersonalizedMenu(roleId);
  }, [clearMenu, fetchPersonalizedMenu, roleId]);

  // F-07: a refused action means the menu offered something the server now
  // refuses (a permission changed mid-session) — re-resolve it.
  const refusals = accessDenied.refusals;
  useEffect(() => {
    if (refusals > 0) reloadMenu();
  }, [refusals, reloadMenu]);

  // A-123: an account whose password an administrator set may use only the
  // change-password screen until it is changed (the backend refuses the rest
  // with 403 PASSWORD_CHANGE_REQUIRED). Go there rather than render pages
  // whose every request would fail.
  const mustChangePassword = user?.mustChangePassword === true;
  // A-160: likewise an account its tenant requires to enrol MFA may use only
  // the MFA page (and change-password, which comes first) until it enrols.
  const mfaEnrolmentRequired = user?.mfaEnrolmentRequired === true;
  useEffect(() => {
    if (!isAuthenticated) return;
    if (mustChangePassword) {
      if (pathname !== CHANGE_PASSWORD_PATH) router.replace(CHANGE_PASSWORD_PATH);
    } else if (mfaEnrolmentRequired && pathname !== MFA_PATH) {
      router.replace(MFA_PATH);
    }
  }, [isAuthenticated, mustChangePassword, mfaEnrolmentRequired, pathname, router]);

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
      {/* F-12: keyboard users skip the navigation. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to main content
      </a>
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
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 sm:p-6 bg-card">
          {menuError && (
            <div
              role="alert"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <span>{menuError}</span>
              <button
                type="button"
                onClick={reloadMenu}
                className="rounded-lg border border-destructive/40 px-3 py-1 font-medium hover:bg-destructive/10"
              >
                Retry
              </button>
            </div>
          )}
          {children}
        </main>
        <AccessDeniedModal
          isOpen={accessDenied.isOpen}
          userName={user?.firstName || user?.username}
          message={accessDenied.message}
          onClose={accessDenied.close}
          onRedirectToProfile={() => {
            accessDenied.close();
            router.push("/dashboard/profile");
          }}
        />
      </div>
    </div>
  );
};

export default DashboardLayout;

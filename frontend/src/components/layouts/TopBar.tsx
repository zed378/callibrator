// src/components/layouts/TopBar.tsx
"use client";

import React from "react";
import { Menu } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import ThemeToggle from "@/components/ThemeToggle";
import Image from "next/image";
import GlobalSearch from "./GlobalSearch";
import NotificationBell from "./NotificationBell";
import { avatarImageProps } from "@/lib/uploadUrl";

interface TopBarProps {
  onToggleSidebar: () => void;
  pathname: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  onToggleSidebar,
  pathname,
}) => {
  const { user } = useAuthStore();
  const currentPage =
    pathname === "/dashboard/profile" || pathname === "/dashboard/account"
      ? "Account"
      : "Dashboard";

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-4 sm:px-6 bg-card/80 backdrop-blur-xl shadow-sm border-b border-border">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {currentPage}
          </h2>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Global search (devices / stock / certificates) */}
        <div className="hidden sm:block">
          <GlobalSearch />
        </div>

        {/* Live notifications */}
        <NotificationBell />

        {/* Theme Toggle */}
        <ThemeToggle />

        <div className="w-px h-5 bg-border mx-1" />

        {/* User Avatar */}
        <div className="flex items-center gap-2.5 ml-1">
          <Image
            {...avatarImageProps(user?.picture)}
            alt={user?.username || "User"}
            width={32}
            height={32}
            className="w-8 h-8 rounded-lg object-cover"
          />
        </div>
      </div>
    </header>
  );
};

export default TopBar;

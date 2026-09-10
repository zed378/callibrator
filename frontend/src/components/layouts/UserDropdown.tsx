// src/components/layouts/UserDropdown.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import Img from "next/image";
import { useRouter } from "next/navigation";
import { ChevronDown, Settings, User, LogOut } from "lucide-react";
import { toSameOriginUpload } from "@/lib/uploadUrl";

interface UserDropdownProps {
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  picture?: string;
  onLogout: () => void;
}

export function UserDropdown({
  username,
  firstName,
  lastName,
  email,
  picture,
  onLogout,
}: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const displayName =
    firstName && lastName ? `${firstName} ${lastName}` : username || "User";
  const avatarLetter = (username || firstName || "U").charAt(0).toUpperCase();

  const handleLogout = async () => {
    await onLogout();
    router.push("/");
  };

  return (
    <div className="relative z-30">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 cursor-pointer h-12 px-3 rounded-xl transition-all duration-300 bg-white/5 shadow-sm hover:bg-muted"
      >
        {picture ? (
          <Img src={toSameOriginUpload(picture)} alt={displayName} width={36} height={36} />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-primary to-accent flex items-center justify-center text-primary-foreground text-xs font-bold shadow-md shadow-primary/20">
            {avatarLetter}
          </div>
        )}
        <div className="hidden lg:block text-left">
          <p className="text-sm font-medium max-w-37.5 truncate text-foreground/90">
            {displayName}
          </p>
          <p className="text-[11px] truncate text-muted-foreground">
            {email || username}
          </p>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-300 ${
            isOpen ? "rotate-180" : "text-muted-foreground"
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl shadow-2xl overflow-hidden z-50 animate-fade-in-down bg-card text-card-foreground border border-border">
          <div className="p-5 border-b border-border/60">
            <div className="flex items-center gap-3">
              {picture ? (
                <Img src={toSameOriginUpload(picture)} alt={displayName} width={50} height={50} />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-linear-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold shadow-lg shadow-primary/20">
                  {avatarLetter}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">
                  {displayName}
                </p>
                {username && username !== displayName && (
                  <p className="text-xs truncate text-muted-foreground">
                    @{username}
                  </p>
                )}
                {email && (
                  <p className="text-xs truncate text-muted-foreground">
                    {email}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="p-2">
            <Link
              href="/dashboard"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              <span>Dashboard</span>
            </Link>
            <Link
              href="/dashboard/profile"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <User className="w-4 h-4 text-muted-foreground" />
              <span>Profile Settings</span>
            </Link>
          </div>

          <div className="p-2 border-t border-border/60">
            <button
              onClick={handleLogout}
              className="w-full cursor-pointer flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
}

export default UserDropdown;

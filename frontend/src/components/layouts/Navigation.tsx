// src/components/layouts/Navigation.tsx
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion, useScroll, useSpring } from "motion/react";
import { useAuthStore } from "@/stores/authStore";
import ThemeToggle from "@/components/ThemeToggle";
import { Menu, X, LogOut } from "lucide-react";
import UserDropdown from "./UserDropdown";
import MagneticButton from "@/components/motion/MagneticButton";
import Image from "next/image";
import { avatarImageProps } from "@/lib/uploadUrl";
import { BrandIcon } from "@/components/brand/BrandIcon";

export function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();

  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isAuthPage = pathname === "/login";
  const isLoggedIn = isAuthenticated && !!user;

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const navLinks = [
    { href: "/#features", label: "Features" },
    { href: "/#compliance", label: "Compliance" },
    { href: "/#platform", label: "Platform" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/blog", label: "Blog" },
    { href: "/news", label: "News" },
  ];

  const navLinkClass = `px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-200 text-muted-foreground hover:text-foreground hover:bg-muted`;

  const getLinkButtonClass = (isPrimary = false) => {
    if (isPrimary) {
      return "px-5 py-2 text-sm font-semibold rounded-xl transition-all duration-300 transform hover:-translate-y-0.5 text-primary-foreground bg-linear-to-r from-primary to-accent shadow-lg shadow-primary/20 hover:shadow-primary/30";
    }
    return "px-4 py-2 text-sm font-semibold rounded-xl transition-colors text-foreground hover:bg-muted";
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        isScrolled
          ? "bg-background/80 backdrop-blur-xl shadow-sm border-b border-border"
          : "bg-transparent"
      }`}
    >
      {/* Scroll-progress indicator */}
      <motion.div
        aria-hidden="true"
        style={{ scaleX }}
        className="absolute bottom-0 left-0 right-0 h-0.5 origin-left bg-linear-to-r from-primary to-accent"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link href="/" className="flex items-center gap-3">
            <BrandIcon className="w-10 h-10 shrink-0 text-[#001250] dark:text-white" />
            <span className="text-lg font-bold tracking-tight text-foreground">
              HDC
            </span>
          </Link>

          <div className="hidden md:flex items-center h-full gap-1 z-30">
            {!isAuthPage &&
              navLinks.map((link) => (
                <Link key={link.href} href={link.href} className={navLinkClass}>
                  {link.label}
                </Link>
              ))}
            <ThemeToggle />
            {isLoggedIn ? (
              <UserDropdown
                username={user?.username}
                firstName={user?.firstName}
                lastName={user?.lastName}
                email={user?.email}
                picture={user?.picture}
                onLogout={handleLogout}
              />
            ) : (
              <>
                <Link href="/login" className={getLinkButtonClass(false)}>
                  Sign In
                </Link>
                <MagneticButton>
                  <Link href="/login" className={getLinkButtonClass(true)}>
                    Get Started
                  </Link>
                </MagneticButton>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden pb-6 animate-fade-in">
            <div className="flex flex-col gap-1">
              {isLoggedIn && (
                <div className="px-4 py-4 rounded-xl shadow-sm mb-2 bg-muted/30">
                  <div className="flex items-center gap-3 mb-3">
                    <Image
                      {...avatarImageProps(user?.picture)}
                      alt={user?.username || "User"}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-xl object-cover border-2 border-primary/50"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-foreground">
                        {user?.firstName && user?.lastName
                          ? `${user.firstName} ${user.lastName}`
                          : user?.username || "User"}
                      </p>
                      {user?.email && (
                        <p className="text-xs truncate text-muted-foreground">
                          {user.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <Link
                    href="/dashboard"
                    className="block w-full px-4 py-2.5 text-sm font-semibold text-center text-primary-foreground bg-linear-to-r from-primary to-accent rounded-xl"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                  <button
                    onClick={async () => {
                      await handleLogout();
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mt-2 text-sm font-medium rounded-xl text-destructive bg-destructive/10 border border-destructive/30"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Logout</span>
                  </button>
                </div>
              )}
              {!isAuthPage &&
                navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={navLinkClass}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              {!isLoggedIn && (
                <>
                  <Link
                    href="/login"
                    className={navLinkClass}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/login"
                    className="mx-0 mt-1 px-4 py-2.5 text-sm font-semibold text-center text-primary-foreground bg-linear-to-r from-primary to-accent rounded-xl"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

export default Navigation;

"use client";

import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";
import { useIsClient } from "@/hooks/useIsClient";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isClient = useIsClient();

  return (
    <button
      onClick={toggleTheme}
      className="cursor-pointer relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
      aria-label={isClient ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Switch to dark mode"}
      title={isClient ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Switch to dark mode"}
    >
      {isClient && theme === "dark" ? (
        <Sun className="w-4 h-4 text-warning" />
      ) : (
        <Moon className="w-4 h-4 text-muted-foreground" />
      )}
    </button>
  );
}

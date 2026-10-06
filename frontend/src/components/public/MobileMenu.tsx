"use client";
/**
 * P10-03 (doc 20 §6.0): the header's disclosure menu below 1024 px. A real
 * `<button aria-expanded>`; focus is kept inside only while it is open; Escape
 * closes it and returns focus to the button. The panel's content (links,
 * language form, CTAs) is rendered by the server and passed in.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "@/components/icons/static";

export function MobileMenu({
  openLabel,
  closeLabel,
  children,
}: {
  openLabel: string;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [buttonRef.current, ...focusables()].filter((el): el is HTMLElement => Boolean(el));
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const onPanelClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // A link inside was chosen: close so the page is visible at its target.
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  };

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((v) => !v)}
        className="pub-btn pub-btn-ghost -mr-2 px-2.5"
      >
        {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
      </button>
      {/* Observes clicks on the links inside (keyboard-operable themselves) to close the panel. */}
      <div
        id={panelId}
        ref={panelRef}
        hidden={!open}
        onClick={onPanelClick}
        className="pub-menu-panel absolute inset-x-0 top-full border-b border-pub-border bg-pub-bg px-4 pb-6 pt-2 shadow-[var(--pub-shadow-md)] sm:px-6"
      >
        {children}
      </div>
    </div>
  );
}

export default MobileMenu;

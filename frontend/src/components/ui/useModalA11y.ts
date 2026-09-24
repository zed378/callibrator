"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** The focusable descendants of `root`, in DOM order. */
export const focusableWithin = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true",
  );

/**
 * F-12: what makes an overlay a modal dialog for a keyboard and screen-reader
 * user, in one place:
 *
 * - focus moves INTO the dialog when it opens (the first focusable element, or
 *   the panel itself) and back to whatever had it when it closes;
 * - Tab and Shift+Tab cycle inside the dialog — they cannot reach the page
 *   behind it;
 * - Escape closes it;
 * - the page behind does not scroll while it is open.
 *
 * Attach the returned ref to the dialog panel (the element with
 * `role="dialog"`). `onClose` is read through a ref, so an inline arrow does
 * not re-run the effect.
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onClose: () => void,
) {
  const panelRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusableWithin(panel)[0];
    (first ?? panel).focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableWithin(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || active === panel)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      } else if (!panel.contains(active)) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  return panelRef;
}

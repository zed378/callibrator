"use client";

import { useEffect } from "react";

/**
 * Drives scroll-entrance animations for the landing page with a single
 * IntersectionObserver. Any element tagged `data-reveal` starts hidden (via
 * the CSS in globals.css) and gets `.is-visible` when it scrolls into view.
 *
 * The hidden state only applies once this component adds `reveal-ready` to
 * <html> after hydration, so content stays visible if JS never runs. The CSS
 * is additionally gated behind `prefers-reduced-motion: no-preference`.
 *
 * Renders nothing; mount it once inside the landing layout.
 */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;

    // `reveal-ready` gates the hidden state; the CSS itself is wrapped in
    // `@media (prefers-reduced-motion: no-preference)`, so reduced-motion users
    // keep every element fully visible even with this class present. It is
    // added once and left in place (sticky) so a React 19 StrictMode / fast-
    // refresh remount cycle can never strand elements in the hidden state.
    root.classList.add("reveal-ready");

    const els = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );

    const reveal = (el: Element) => el.classList.add("is-visible");

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );

    const vh = window.innerHeight;
    for (const el of els) {
      // Already on screen at load → reveal immediately (no above-the-fold flash).
      if (el.getBoundingClientRect().top < vh * 0.9) {
        reveal(el);
      } else {
        observer.observe(el);
      }
    }

    // Only tear down the observer — keep `reveal-ready` sticky (see above).
    return () => observer.disconnect();
  }, []);

  return null;
}

export default ScrollReveal;

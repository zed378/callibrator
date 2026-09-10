import React from "react";

/**
 * Small uppercase section label with a leading rule — the editorial "eyebrow".
 * Replaces the repeated pill-badge markup that every section used to hand-roll.
 */
export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground ${className}`}
    >
      <span
        className="h-px w-8 bg-linear-to-r from-primary to-accent"
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

export default Eyebrow;

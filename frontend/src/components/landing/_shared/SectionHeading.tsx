import React from "react";

/**
 * Restrained editorial heading: solid `text-foreground`, tight leading/tracking,
 * balanced wrapping. Emphasis is added by the caller (an accent `<span>` or the
 * <Underline> helper) rather than the old formulaic gradient second-line.
 */
export function SectionHeading({
  children,
  as: Tag = "h2",
  className = "",
}: {
  children: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <Tag
      className={`font-display text-balance font-bold leading-[1.08] tracking-tight text-foreground text-3xl sm:text-4xl lg:text-[2.75rem] ${className}`}
    >
      {children}
    </Tag>
  );
}

export default SectionHeading;

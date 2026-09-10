import React from "react";

/**
 * Wraps a word/phrase with a hand-drawn underline stroke — a deliberately
 * imperfect, "drawn" accent used sparingly in headings so the type feels
 * authored rather than templated. Inline SVG, no assets.
 */
export function Underline({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`relative inline-block whitespace-nowrap ${className}`}>
      <span className="relative z-10">{children}</span>
      <svg
        className="absolute -bottom-1.5 left-0 h-[0.42em] w-full text-primary/45"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <path
          className="reveal-underline"
          pathLength={1}
          d="M1.5 5.2 C 22 1.8, 43 7.4, 62 4.1 S 88 2.2, 98.5 5.6"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export default Underline;

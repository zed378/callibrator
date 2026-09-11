import React from "react";

/**
 * The Device Calibrator symbol mark, inline.
 *
 * Inline rather than an <Image src="/brand/mark.svg">, for two reasons:
 *
 * 1. `next/image` routes every src through /_next/image, which answers 400 for
 *    SVG unless images.dangerouslyAllowSVG is set — see src/lib/uploadUrl.ts.
 *    Inlining sidesteps the optimizer entirely.
 * 2. The mark has to work on both themes. The body is `currentColor`, so a
 *    caller sets it with a text colour class and it follows the theme; the
 *    teal accent is fixed, because it is the brand colour.
 *
 * Brand palette: navy #001250, teal #00DAB4.
 */
export function BrandIcon({
  className = "",
  accent = "#00DAB4",
  title,
}: {
  className?: string;
  /** The fixed accent. Override only for a monochrome rendering. */
  accent?: string;
  /** Give a title only when the mark is the sole label; otherwise it is decorative. */
  title?: string;
}) {
  return (
    <svg
      viewBox="4885.00 7540.00 11700.00 11700.00"
      className={className}
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <g>
      <rect fill="currentColor" x="5806.89" y="8426.51" width="1234.83" height="1322.54" rx="300.11" ry="382.66"/>
      <rect fill="currentColor" x="5806.89" y="8426.51" width="1234.83" height="1322.54" rx="300.11" ry="382.66"/>
      <rect fill="currentColor" x="7450.35" y="8426.52" width="396.28" height="1322.52"/>
      <rect fill="currentColor" x="8277.07" y="8426.52" width="396.28" height="1322.52"/>
      <rect fill="currentColor" x="9103.79" y="8426.52" width="396.28" height="1322.52"/>
      <rect fill="currentColor" x="9930.51" y="8426.52" width="396.28" height="1322.52"/>
      <rect fill="currentColor" transform="matrix(2.44447E-14 -0.985549 0.922976 2.61017E-14 5807.82 10674.6)" width="402.09" height="1341.91"/>
      <rect fill="currentColor" transform="matrix(2.44447E-14 -0.985549 0.922976 2.61017E-14 5807.82 11560.3)" width="402.09" height="1341.91"/>
      <rect fill="currentColor" transform="matrix(2.44447E-14 -0.985549 0.922976 2.61017E-14 5807.82 12446.1)" width="402.09" height="1341.91"/>
      <rect fill={accent} transform="matrix(2.44447E-14 -0.985549 0.922976 2.61017E-14 5807.82 13331.9)" width="402.09" height="1341.91"/>
      <rect fill={accent} transform="matrix(2.44447E-14 -0.985549 0.922976 2.61017E-14 5807.82 14217.7)" width="402.09" height="1341.91"/>
      <rect fill={accent} transform="matrix(2.44447E-14 -0.985549 0.922976 2.61017E-14 5807.82 15103.4)" width="402.09" height="1341.91"/>
      <path fill="currentColor" d="M13175.03 13115.84l0 -1681.74c0,-331.68 -271.37,-602.18 -603.03,-603.03 -551.12,-1.41 -1102.15,-15.53 -1653.23,-3.68 -82.59,1.85 -142.87,-73.54 -142.87,-152.98l0 -2244.52 2579.78 0 2308.74 2448.89 0 2237.06 -2489.4 0z"/>
      <path fill={accent} d="M10775.91 15667.47l1796.1 0c331.66,0 603.03,-271.36 603.03,-603.03l0 -1494.54 2489.4 0 0 2225.38 -2411.18 2557.55 -2477.35 0 0 -2685.35z"/>
      <polygon fill="currentColor" points="8611.87,15667.47 9075.33,15667.47 10321.85,15667.47 10321.85,18352.82 8227.73,18352.82 5812.14,15790.6 5812.14,15667.47 "/>
      </g>
    </svg>
  );
}

export default BrandIcon;

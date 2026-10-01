/**
 * Content-Security-Policy directives for the API origin (P7-08).
 *
 * Before P7-08 ONE policy covered the whole API origin, and it allowed
 * `'unsafe-inline'` for scripts "because the bundled swagger-ui injects inline
 * assets". Two things were wrong with that:
 *
 *  - swagger-ui-express does not need inline SCRIPT. Its page loads
 *    swagger-ui-bundle.js, swagger-ui-standalone-preset.js and
 *    swagger-ui-init.js as external files (node_modules/swagger-ui-express/
 *    index.js, the `<script src=...>` lines); only its CSS is inline, and
 *    Swagger UI's React components set inline `style` attributes.
 *  - the reasoning, even where it held, belonged to one page, not to every
 *    response of the origin.
 *
 * So the API default drops `'unsafe-inline'` for scripts, and Swagger got its
 * own policy, applied only under `/docs`. P9-25 (ADR-103) replaced Swagger UI
 * with Scalar; the `/docs` policy is now `API_DOCS_CSP_DIRECTIVES`, tighter than
 * the default (no third-party style or font origin). Both still allow
 * inline STYLE: the `/documentation` page (docs/DOCUMENTATION.html) carries a
 * `<style>` block and ~250 `style=` attributes, and Swagger UI needs it too.
 * Inline style is a much smaller risk than inline script (no code execution);
 * removing it is a separate job on those pages.
 *
 * P9-09 (ADR-087): converted from csp.util.js with no behaviour change.
 */
import type { NextFunction, Request, Response } from "express";

/** CSP directives in helmet's format: a source list, or `null` for a valueless directive. */
export type CspDirectives = Readonly<Record<string, readonly string[] | null>>;

/** The default policy for every API response. */
const API_CSP_DIRECTIVES: CspDirectives = Object.freeze({
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "script-src-attr": ["'none'"],
  "style-src": ["'self'", "'unsafe-inline'", "https:"],
  "img-src": ["'self'", "data:", "https:"],
  "font-src": ["'self'", "data:", "https:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "upgrade-insecure-requests": null,
});

/**
 * The API reference under /docs (P9-25, ADR-103: Scalar replaced Swagger UI).
 * Still no inline script — the page loads its bundle and its start-up script
 * as files. `connect-src 'self'` lets the spec load and "try it" call the API
 * on the same origin and nothing else (Scalar's proxy, telemetry and AI agent
 * endpoints are refused by the browser even if a setting turned them on).
 * Styles and fonts are same-origin only: Scalar injects `<style>` elements
 * (inline style, as the default allows) and its default web fonts are off, so
 * the page makes no third-party request at all.
 */
const API_DOCS_CSP_DIRECTIVES: CspDirectives = Object.freeze({
  ...API_CSP_DIRECTIVES,
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
});

/**
 * Render directives as a header value (helmet's format), for the API-docs
 * override and for tests.
 */
const renderCsp = (directives: CspDirectives): string =>
  Object.entries(directives)
    .map(([name, values]) => (values?.length ? `${name} ${values.join(" ")}` : name))
    .join(";");

/**
 * Middleware: replace the origin-wide CSP header with the API reference's own,
 * for the page it is mounted on (`routes/internal/apiDocs.route.ts`).
 */
const apiDocsCsp = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Content-Security-Policy", renderCsp(API_DOCS_CSP_DIRECTIVES));
  next();
};

export { API_CSP_DIRECTIVES, API_DOCS_CSP_DIRECTIVES, renderCsp, apiDocsCsp };

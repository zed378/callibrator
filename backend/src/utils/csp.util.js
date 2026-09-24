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
 * So the API default drops `'unsafe-inline'` for scripts, and Swagger gets its
 * own policy, applied only under `/docs` (docs/swagger.js). Both still allow
 * inline STYLE: the `/documentation` page (docs/DOCUMENTATION.html) carries a
 * `<style>` block and ~250 `style=` attributes, and Swagger UI needs it too.
 * Inline style is a much smaller risk than inline script (no code execution);
 * removing it is a separate job on those pages.
 */

/** The default policy for every API response. */
const API_CSP_DIRECTIVES = Object.freeze({
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
 * Swagger UI under /docs. Still no inline script; `connect-src 'self'` lets
 * "Try it out" call the API on the same origin, and `img-src data:` covers
 * the SVG icons Swagger UI inlines.
 */
const SWAGGER_CSP_DIRECTIVES = Object.freeze({
  ...API_CSP_DIRECTIVES,
  "connect-src": ["'self'"],
});

/**
 * Render directives as a header value (helmet's format), for the Swagger
 * override and for tests.
 * @param {Record<string, string[]|null>} directives
 * @returns {string}
 */
const renderCsp = (directives) =>
  Object.entries(directives)
    .map(([name, values]) => (values && values.length ? `${name} ${values.join(" ")}` : name))
    .join(";");

/**
 * Middleware: replace the origin-wide CSP header with Swagger's own, for the
 * requests it is mounted on (`/docs`).
 */
const swaggerCsp = (req, res, next) => {
  res.setHeader("Content-Security-Policy", renderCsp(SWAGGER_CSP_DIRECTIVES));
  next();
};

module.exports = { API_CSP_DIRECTIVES, SWAGGER_CSP_DIRECTIVES, renderCsp, swaggerCsp };

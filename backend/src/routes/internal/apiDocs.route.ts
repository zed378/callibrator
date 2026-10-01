/**
 * P9-25 (ADR-103) — the API reference: Scalar over the generated OpenAPI 3.1
 * document, behind sign-in. Replaces Swagger UI (`docs/swagger.js`).
 *
 * WHO: the same gate as the other developer surfaces (API keys, webhooks):
 * `auth` → `denyApiKey` → `rbac([TENANT_ADMIN])`. A tenant admin (and any
 * higher level) passes; the platform super admin passes by rbac's bypass; an
 * API key never does. Nothing here is public — owner brief P9-25, "Publishing:
 * behind login".
 *
 * HOW A BROWSER GETS IN: the backend authenticates with a Bearer header only.
 * The frontend's `/api/v1/[...path]` proxy turns the signed-in session cookie
 * into that header, so a signed-in admin opens `<frontend>/api/v1/docs`; the
 * page, its two scripts, the spec and every "try it" call go through the same
 * proxy with the same cookie. `/docs` on the API origin answers the same to a
 * client that sends the header itself (curl, CI).
 *
 * WHAT IS SERVED — no CDN (CSP, ADR-103):
 *   GET /                 the page: markup only, no inline script
 *   GET /assets/scalar.js Scalar's standalone bundle (@scalar/api-reference, MIT)
 *   GET /assets/init.js   the four lines that start it, from a file, not inline
 *   GET /openapi.json     the committed `openapi.json` (`npm run openapi:generate`)
 * and, as a second router mounted at `/docs.json`, the spec at its old URL.
 */
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type RequestHandler, type Response } from "express";
import { ROLE_NAMES } from "../../constants";
import { rbac } from "../../middlewares/rbac.middleware";
import { apiDocsCsp } from "../../utils/csp.util";
import appPath from "../../utils/appPath.util";

// middlewares/auth.middleware is JavaScript until P9-19 converts it; under the release build's
// allowJs: false a .ts file cannot import it, so it is required and typed by the two gates used.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a JavaScript module, typed at the boundary
const { auth, denyApiKey } = require("../../middlewares/auth.middleware") as {
  auth: RequestHandler;
  denyApiKey: RequestHandler;
};

/** Where the image puts Scalar's bundle beside the binary (Dockerfile). */
const SHIPPED_BUNDLE = ["docs-ui", "scalar.standalone.js"] as const;

/** The two places the page is mounted; anything else renders the first. */
const MOUNTS = ["/docs", "/api/v1/docs"] as const;

// withDefaultFonts: false drops the theme's font variables, but the bundle's own
// @font-face rules still point at fonts.scalar.com — seen live in Chrome, refused by
// the CSP (ADR-103). customCss sets system fonts (!important: Scalar appends its theme
// CSS AFTER customCss), so the browser never asks for them.
const INIT_SCRIPT = `(function () {
  var el = document.getElementById("api-reference");
  window.Scalar.createApiReference(el, {
    url: el.getAttribute("data-spec-url"),
    withDefaultFonts: false,
    telemetry: false,
    persistAuth: false,
    hideClientButton: true,
    agent: { disabled: true },
    mcp: { disabled: true },
    customCss: "* { --scalar-font: system-ui, sans-serif !important; --scalar-font-code: ui-monospace, monospace !important; }"
  });
})();
`;

/** The mount this request came through, from a fixed list — never echoed from the URL. */
const mountOf = (req: Request): (typeof MOUNTS)[number] =>
  MOUNTS.find((m) => m === req.baseUrl.toLowerCase()) ?? MOUNTS[0];

const page = (base: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Callibrator API reference</title>
</head>
<body>
<div id="api-reference" data-spec-url="${base}/openapi.json"></div>
<script src="${base}/assets/scalar.js"></script>
<script src="${base}/assets/init.js"></script>
</body>
</html>
`;

/**
 * Scalar's standalone bundle: shipped beside the binary in the image, else the
 * installed package. `null` when neither exists.
 */
export const scalarBundlePath = (
  shipped: string = appPath(...SHIPPED_BUNDLE),
  resolve: () => string = () => require.resolve("@scalar/api-reference"),
): string | null => {
  if (fs.existsSync(shipped)) {
    return shipped;
  }
  try {
    const installed = path.join(path.dirname(resolve()), "browser", "standalone.js");
    return fs.existsSync(installed) ? installed : null;
  } catch {
    return null;
  }
};

const unavailable = (res: Response, what: string): void => {
  res.status(503).json({ success: false, status: 503, message: `${what} is not available on this build`, data: null });
};

const sendPage = (req: Request, res: Response): void => {
  res.setHeader("Cache-Control", "private, no-store");
  res.type("html").send(page(mountOf(req)));
};

const sendInit = (_req: Request, res: Response): void => {
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.type("application/javascript").send(INIT_SCRIPT);
};

const sendBundle = (_req: Request, res: Response): void => {
  const file = scalarBundlePath();
  if (file === null) {
    unavailable(res, "The API reference UI");
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.type("application/javascript").send(fs.readFileSync(file));
};

const sendSpec = (_req: Request, res: Response): void => {
  const file = appPath("openapi.json");
  if (!fs.existsSync(file)) {
    unavailable(res, "The API contract (openapi.json)");
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.type("application/json").send(fs.readFileSync(file));
};

const gate = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];

/** The reference UI, its assets and the spec — mounted at `/docs` and `/api/v1/docs`. */
const apiDocsRoutes = express.Router();
apiDocsRoutes.get("/", ...gate, apiDocsCsp, sendPage);
apiDocsRoutes.get("/assets/scalar.js", ...gate, sendBundle);
apiDocsRoutes.get("/assets/init.js", ...gate, sendInit);
apiDocsRoutes.get("/openapi.json", ...gate, sendSpec);

/** The spec at its pre-P9-25 URL, `/docs.json`. */
const apiDocsSpecRoutes = express.Router();
apiDocsSpecRoutes.get("/", ...gate, sendSpec);

export { apiDocsRoutes, apiDocsSpecRoutes, INIT_SCRIPT };

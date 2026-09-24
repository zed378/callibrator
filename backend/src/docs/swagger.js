const fs = require("fs");
const swaggerUi = require("swagger-ui-express");

const appPath = require("../utils/appPath.util");
const { swaggerCsp } = require("../utils/csp.util");

const swaggerSpec = JSON.parse(
  fs.readFileSync(appPath("swagger.json"), "utf8"),
);

// Remove xSession API Key scheme — it conflicts with bearerAuth JWT
// and causes Swagger UI to prompt for the wrong auth header.
// Keep bearerAuth scheme for proper Bearer token authentication in Swagger UI.
if (swaggerSpec.components?.securitySchemes) {
  delete swaggerSpec.components.securitySchemes.xSession;
}
if (swaggerSpec.securityDefinitions) {
  delete swaggerSpec.securityDefinitions.xSession;
}

/**
 * Whether the API contract is published at all (S-23). It used to be mounted
 * unconditionally, unauthenticated, and was unreachable in production only
 * because no nginx location routed /docs — an accident of routing, not a
 * decision. Now: on outside production; OFF in production unless
 * SWAGGER_ENABLED=true says otherwise on purpose.
 * @returns {boolean}
 */
const swaggerEnabled = () =>
  process.env.SWAGGER_ENABLED === "true" ||
  (process.env.SWAGGER_ENABLED !== "false" && process.env.NODE_ENV !== "production");

const swaggerDocs = (app) => {
  if (!swaggerEnabled()) {
    return false;
  }
  // Always expose the raw spec — packager-agnostic (no swagger-ui-dist assets
  // needed), so the API contract stays reachable even where the interactive UI
  // (which serves the embedded/shipped swagger-ui-dist, pkg-first) is not
  // available.
  app.get("/docs.json", (req, res) => res.json(swaggerSpec));

  // P7-08: Swagger's own CSP, only here. The origin default (index.js) is
  // stricter; see utils/csp.util.js.
  app.use(
    "/docs",
    swaggerCsp,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,

      swaggerOptions: {
        persistAuthorization: true,
        // Use bearerAuth (JWT) instead of the incorrect xSession API key
        security: [{ bearerAuth: [] }],
      },
    }),
  );

  // A-253 — the developer HTML pages. index.js served them unconditionally
  // and unauthenticated, production included: DOCUMENTATION.html and
  // CODING_STANDARDS.html describe the internals (middleware order, the
  // tenant hooks, where authorization lives) — reconnaissance, not product.
  // They are developer documentation of the same class as the API contract,
  // so they are published under the same switch: off in production unless
  // SWAGGER_ENABLED=true. appPath (execPath-relative when packaged) reads
  // them from the docs folder shipped next to a compiled binary, where
  // res.sendFile cannot reach a file embedded under __dirname.
  app.get("/documentation", (req, res) => res.sendFile(appPath("docs", "DOCUMENTATION.html")));
  app.get("/standards", (req, res) => res.sendFile(appPath("docs", "CODING_STANDARDS.html")));
  return true;
};

module.exports = {
  swaggerDocs,
  swaggerEnabled,
};

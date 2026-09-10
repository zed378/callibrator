const path = require("path");
const fs = require("fs");
require("./env.util");

const swaggerJsdoc = require("swagger-jsdoc");
const { logger } = require("../middlewares/activityLog.middleware");
const components = require("../docs/components");
const tags = require("../docs/tags");

const outputProdPath = path.resolve(__dirname, "../../swagger.json");

// Build an array of individual route files instead of using glob patterns.
// swagger-jsdoc v6.x glob patterns (*.js) fail on Windows and with relative
// paths. Resolving each file explicitly ensures 100 % match rate across OSes.
const routesDir = path.resolve(__dirname, "../routes/api");
const apiFiles = fs
  .readdirSync(routesDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => path.resolve(routesDir, file));

const internalDir = path.resolve(__dirname, "../routes/internal");
const internalFiles = fs
  .readdirSync(internalDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => path.resolve(internalDir, file));

const allFiles = [...apiFiles, ...internalFiles];

const options = {
  definition: {
    openapi: "3.0.0",

    info: {
      title: "Calibrator API",
      version: "1.0.0",
      description: "Enterprise-grade Express.js API documentation",
    },

    servers: [
      {
        url: process.env.HOST_URL,
      },
    ],

    tags: tags.tags,
  },

  apis: allFiles,
};

// Generate the swagger spec from JSDoc comments
const swaggerSpec = swaggerJsdoc(options);

// Since we moved all component definitions to docs/components.js, we inject
// them back here after generation so $ref: '#/components/schemas/...' works.
swaggerSpec.components = mergeComponents(
  swaggerSpec.components || {},
  components.components,
);

fs.writeFileSync(outputProdPath, JSON.stringify(swaggerSpec, null, 2));

logger.info(`Swagger generated at ${outputProdPath}`);

/**
 * Deep-merge external components into the swagger spec.
 * Handles schemas, securitySchemes, parameters, requestBodies, responses, examples.
 */
function mergeComponents(target, source) {
  const merged = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (key === "securitySchemes") {
      merged.securitySchemes = { ...merged.securitySchemes, ...value };
    } else if (key === "schemas") {
      merged.schemas = { ...merged.schemas, ...value };
    } else if (key === "parameters") {
      merged.parameters = { ...merged.parameters, ...value };
    } else if (key === "requestBodies") {
      merged.requestBodies = { ...merged.requestBodies, ...value };
    } else if (key === "responses") {
      merged.responses = { ...merged.responses, ...value };
    } else if (key === "examples") {
      merged.examples = { ...merged.examples, ...value };
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

module.exports = { mergeComponents };

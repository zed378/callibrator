// @callibrator/contracts lint (P9-22, ADR-097). It mirrors the TypeScript block
// of backend/eslint.config.js (ADR-087 decision 6): strictTypeChecked +
// stylisticTypeChecked, type-aware, every standards-document rule an error.
// The backend-only rules (shared types in src/types/, raw SQL through
// sql.util, process.env only in src/config/) have nothing to match here; the
// last is replaced by a stricter one: this package reads no environment at all.
const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");
const tseslint = require("typescript-eslint");

const NO_ENUM = { selector: "TSEnumDeclaration", message: "Use an `as const` object and a union (docs/ENGINEERING/04)." };

module.exports = [
  { ignores: ["node_modules/", "*.config.js"] },
  js.configs.recommended,
  prettier,
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/no-namespace": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-nocheck": true, "ts-expect-error": "allow-with-description" },
      ],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-syntax": ["error", NO_ENUM],
      // Both ends load this code: no environment, no Node or DOM globals.
      "no-restricted-globals": [
        "error",
        { name: "process", message: "@callibrator/contracts runs in the browser too; it reads no environment." },
        { name: "window", message: "@callibrator/contracts runs on the server too." },
        { name: "document", message: "@callibrator/contracts runs on the server too." },
      ],
    },
  },
];

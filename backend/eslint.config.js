const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");
const tseslint = require("typescript-eslint");

// ADR-087 — shared types live in src/types/. A global augmentation, or a type
// named like the response envelope, declared anywhere else is a lint error, so
// a second copy of a shared shape fails review instead of drifting from the first.
const SHARED_TYPE_MESSAGE = "Shared types live in src/types/ (ADR-087, src/types/README.md).";
const SHARED_TYPES_ONLY_IN_TYPES_DIR = [
  { selector: "TSModuleDeclaration[kind='global']", message: SHARED_TYPE_MESSAGE },
  { selector: "TSTypeAliasDeclaration[id.name=/Envelope$|^ApiResponse/]", message: SHARED_TYPE_MESSAGE },
  { selector: "TSInterfaceDeclaration[id.name=/Envelope$|^ApiResponse/]", message: SHARED_TYPE_MESSAGE },
];

// P9-07 — raw SQL goes through utils/sql.util (bind parameters only; ADR-039). A direct
// `sequelize.query(...)` / `db.query(...)` / `x.sequelize.query(...)` in a TypeScript source
// file is an error outside that helper. JavaScript call sites move to the helper as their
// modules convert (Stage C). A raw pg client (`connection.query`) is a different API.
const RAW_QUERY_MESSAGE = "Run raw SQL through utils/sql.util#sql (bind parameters only; P9-07, ADR-039).";
// ADR-087 Amendment 15: a module that uses `export =` exports NOTHING else — not even a type.
// tsx/esbuild compiles `export interface X` beside `export =` into a reference to an
// undefined `<file>_module`, which throws when the module LOADS, while typecheck and jest
// (Babel) both pass: webauthn.service crashed the boot this way on 2026-09-30. Put the
// types in src/types/ or a sibling .d.ts. scripts/load-check.ts is the runtime net.
const EXPORT_EQUALS_ALONE = [
  {
    selector: "Program:has(TSExportAssignment) > ExportNamedDeclaration",
    message:
      "A module with `export =` must export nothing else (tsx emits an undefined `<file>_module` and the module throws at load — ADR-087 Amendment 15). Move the type to src/types/ or a .d.ts.",
  },
  {
    selector: "Program:has(TSExportAssignment) > ExportDefaultDeclaration",
    message: "A module with `export =` must export nothing else (ADR-087 Amendment 15).",
  },
];

const RAW_QUERY_OUTSIDE_THE_HELPER = [
  { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='query'][callee.object.name=/^(sequelize|db|database)$/]", message: RAW_QUERY_MESSAGE },
  { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='query'][callee.object.property.name='sequelize']", message: RAW_QUERY_MESSAGE },
];

module.exports = [
  // P9-02 — GLOBAL ignores. In flat config, `ignores` is global only in an
  // object that has no other key; beside `rules` it scoped that one object, so
  // `dist/` and `coverage/` were linted and `*.config.js` merely escaped the
  // house rules (verified by isPathIgnored over the tree, 2026-09-28).
  {
    ignores: [
      "dist/",
      "coverage/",
      "build/",
      "docs/",
      "*.config.js",
    ],
  },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js / CommonJS globals
        module: "readonly",
        exports: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        // Web/Node globals used by this codebase
        fetch: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        global: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        // Jest globals. `test` was missing, which produced 385 no-undef errors
        // — enough to bury every real finding in the output.
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        afterAll: "readonly",
        afterEach: "readonly",
        jest: "readonly",
      },
    },
    rules: {
      // P9-02a (2026-10-02): raised to error once the count reached 0 (126 triaged, every one in a
      // test: a deletion, or a `_` prefix where position or a rest pattern makes the name load-bearing).
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", vars: "all" },
      ],
      // P9-02a: runtime code logs through winston (A-42); the reasoned exceptions are listed below.
      "no-console": "error",
      "no-dupe-keys": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-fallthrough": "error",
      // `builtinGlobals: false`: webhook.service.js declares `/* global fetch,
      // AbortController */` for readers, and those are also declared above.
      "no-redeclare": ["error", { builtinGlobals: false }],
      "no-this-before-super": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unused-expressions": ["error", { allowShortCircuit: true }],
      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "error",
      // `null: "ignore"`: `x == null` is the deliberate idiom for "null or
      // undefined" and is used that way here (kanban.service.js wipLimit and
      // sprintId). Requiring `===` there would change behaviour for undefined.
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "all"],
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
      semi: ["error", "always"],
      quotes: ["error", "double", { avoidEscape: true }],
      indent: ["error", 2, { SwitchCase: 1 }],
      "comma-dangle": ["error", "always-multiline"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "keyword-spacing": "error",
      "space-infix-ops": "error",
      "no-trailing-spaces": "error",
      "eol-last": ["error", "always"],
      "no-prototype-builtins": "off",
      // Constant conditions are common in middleware (always-true guards)
      "no-constant-condition": "warn",
    },
  },
  // P9-02 (ADR-038, ADR-087) — converted TypeScript files. Before this block
  // ESLint matched no .ts file at all, so a conversion silently took its file
  // out of the lint gate. Type-aware (typed linting runs on the `typescript`
  // 6 API package: typescript-eslint does not support TypeScript 7 — ADR-076;
  // the type CHECK is TypeScript 7, `npm run typecheck`). Every rule the
  // standards document names is an error, never a warning.
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
      // ADR-087 Amendment 5: this stylistic rule asks for `x!` instead of
      // `x as T` — the very `!` the rule above bans. With both on, a checked
      // narrowing can satisfy neither, so the stylistic one is off.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      // `declare global { namespace NodeJS { … } }` is how a global is
      // augmented (docs/ENGINEERING/04 does the same for Express); a runtime
      // namespace stays banned.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
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
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use an `as const` object and a union (docs/ENGINEERING/04)." },
        ...SHARED_TYPES_ONLY_IN_TYPES_DIR,
        ...RAW_QUERY_OUTSIDE_THE_HELPER,
        ...EXPORT_EQUALS_ALONE,
      ],
    },
  },
  {
    // P9-07: the helper itself, the tests (live probes and fakes query directly), and
    // migrations (DDL through the QueryInterface, outside any tenant; the helper is SELECT-only).
    files: ["src/utils/sql.util.ts", "src/tests/**/*.ts", "src/migrations/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use an `as const` object and a union (docs/ENGINEERING/04)." },
        ...SHARED_TYPES_ONLY_IN_TYPES_DIR,
        ...EXPORT_EQUALS_ALONE,
      ],
    },
  },
  {
    // src/types/ is where shared types live (ADR-087, src/types/README.md):
    // the enum ban still applies there, the shared-type ban does not.
    files: ["src/types/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use an `as const` object and a union (docs/ENGINEERING/04)." },
        ...EXPORT_EQUALS_ALONE,
      ],
    },
  },
  {
    // process.env is read raw only inside src/config/ (docs/ENGINEERING/04).
    files: ["**/*.ts"],
    ignores: ["src/config/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Read configuration through src/config/." },
      ],
    },
  },
  // P9-10 (ADR-087 Amendment 11): the rule that barred production .ts files from importing the
  // JavaScript models barrel (Amendment 7) is retired — the barrel is TypeScript and typed.
  {
    // P9-02a — the reasoned no-console allow-list. Each entry writes to a terminal on purpose:
    //  - src/scripts/: the operator CLIs (CLAUDE.md: `console.*` only in the CLIs of src/scripts/);
    //    their stdout/stderr IS their interface, read by the operator or a pipeline.
    //  - src/tests/e2e/setup.js: the live E2E harness reports the server's readiness to the person
    //    running `make test-e2e`; it never runs inside the application.
    //  - src/utils/checkMenu.util.js: a dead diagnostic whose deletion awaits the owner (A-18).
    files: ["src/scripts/**/*.ts", "src/tests/e2e/setup.js", "src/utils/checkMenu.util.js"],
    rules: { "no-console": "off" },
  },
];

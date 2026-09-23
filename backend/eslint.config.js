const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");

module.exports = [
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
      // Allow unused vars with _ prefix in production; be lenient in tests
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", vars: "all" },
      ],
      "no-console": "warn",
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
      "prefer-arrow-callback": "warn",
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
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "*.config.js",
      "docs/",
      "build/",
    ],
  },
];

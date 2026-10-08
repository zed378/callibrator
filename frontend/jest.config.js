// ADR-076 — the transform under TypeScript 7.
//
// ts-jest calls the TypeScript compiler API, which TypeScript 7 does not ship.
// `typescript` in this workspace is therefore the TypeScript 6 compatibility
// package (npm:@typescript/typescript6, the side-by-side arrangement the TS 7
// release recommends), and TypeScript 7 is `@typescript/native`, run by
// `npm run typecheck`. With tsconfig's `isolatedModules: true`, ts-jest only
// TRANSPILES (ts.transpileModule) — it type-checks nothing; the TypeScript 7
// typecheck gate, which CI and `make verify` run, is where types are checked.
//
// next/jest (SWC) was tried and refused: it emits imports in ESM order, ahead
// of the module-scope mock objects 13 suites declare before their imports, and
// those suites fail with "Cannot access 'x' before initialization".
/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/dist/'],
  // 2026-09-29 (ADR-067 Amendment 1): full-page suites render the real hook,
  // store and service chain, and each `findBy*` may wait up to 5 s
  // (jest.setup.ts). Under coverage, with ~260 suites in parallel, a test with
  // two or three awaited steps overran Jest's 5 s default in the full run
  // while passing alone (api-keys, billing, esignature, menu-groups pages).
  // The per-test ceiling only bounds how long a FAILING test takes to report;
  // it changes no assertion.
  testTimeout: 30000,
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  // A-298: sanitize-html (lib/safeHtml) parses with htmlparser2, whose
  // current line and its dom* / entities dependencies ship ES modules only.
  // Jest here runs CommonJS, so those six are transformed (ts-jest, allowJs);
  // every other node_module is left alone, as before. Next bundles them
  // natively, so this is test-only.
  transformIgnorePatterns: [
    '[/\\\\]node_modules[/\\\\](?!(htmlparser2|domhandler|domutils|dom-serializer|entities|domelementtype)[/\\\\])',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    // The root documents (ADR-131: one per route group, plus the global 404).
    // Their shared body, app/rootDocument.tsx, is tested and counted.
    '!src/app/(public)/layout.tsx',
    '!src/app/(app)/layout.tsx',
    '!src/app/global-not-found.tsx',
    '!src/app/(public)/page.tsx',
    // Test infrastructure (helpers under src/tests), not product code.
    '!src/tests/**',
  ],
  // F-03 / F-04 (AUDIT-2026-09-FRONTEND): the gate that runs.
  //
  // This block used to say 70% while nothing evaluated it — `npm test` ran
  // plain `jest` — and the real figure was 28% (2026-09-24, 986 tests). It is
  // now evaluated on every `npm test` (package.json: `jest --coverage`), set
  // just under what the suite measures today, so it passes honestly and fails
  // on any regression. Measured 2026-09-24 after F-03/F-04 work: statements
  // 42.13%, branches 36.61%, functions 35.80%, lines 42.45%.
  //
  // Ratchet — docs/FRONTEND/10-TESTING.md § Coverage gate.
  // Raise these numbers in the same change that raises the coverage; never
  // lower them, and never reach them by excluding product code.
  //
  // 2026-09-30 (ADR-067 Amendment 1): measured 90.91% statements, 81.62%
  // branches, 86.94% functions, 91.61% lines (264 suites, 2,758 tests) after
  // the coverage batch; the gate is each figure rounded down. The 70% target
  // is passed on all four measures.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 81,
      functions: 86,
      lines: 91,
    },
  },
};

module.exports = config;

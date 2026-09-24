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
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/layout.tsx',
    '!src/app/page.tsx',
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
  // Ratchet to the 70% target — docs/FRONTEND/10-TESTING.md § Coverage gate.
  // Raise these numbers in the same change that raises the coverage; never
  // lower them, and never reach them by excluding product code.
  coverageThreshold: {
    global: {
      statements: 41,
      branches: 35,
      functions: 34,
      lines: 41,
    },
  },
};

module.exports = config;

import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// `npm test` runs `jest --coverage` (F-03). Under coverage instrumentation, on a
// loaded machine, full-page suites that render a real hook + service chain
// (page.a156 backup restore, DataRetentionPage A-135) took longer than Testing
// Library's default 1000 ms for `findBy*` / `waitFor` and failed
// intermittently: 4 failures in 1 of 3 coverage runs on 2026-09-25, 0 in 3 runs
// without coverage. A longer ceiling only costs time when a test is failing
// anyway; it does not change what any assertion accepts.
configure({ asyncUtilTimeout: 5000 });

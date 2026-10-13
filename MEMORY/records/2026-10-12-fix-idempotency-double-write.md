# Fix: an `Idempotency-Key` request that ended in an error crashed the API process

**Date:** 2026-10-12 · **Card:** urgent defect, from a coordinator report (reproduced twice on a stack built from `de2e938`) · **ADR:** ADR-127 Amendment 5

## Defect

`POST /api/v1/ipm/sessions/:id/submit` on an incomplete draft, sent with an `Idempotency-Key`, took the API down. The sequence:

1. `ipmSubmit.service#assertComplete` threw `AppError(400)`.
2. `asyncHandler` answered through the middleware's wrapped `res.json`. The wrapper settles the key first, so the answer leaves a moment later.
3. `asyncHandler` then forwarded the error to `errorHandler`. It saw `headersSent` still false and answered **again**.
4. The second deferred send threw `ERR_HTTP_HEADERS_SENT` inside `.finally()`.
5. The unhandled rejection reached `index.ts` (`UNHANDLED_REJECTION`), which shut down; the container restarted.

Any keyed request ending in an error was exposed, and those are exactly what the offline outbox replays.

## Fix (`backend/src/middlewares/idempotency.middleware.ts`, `settleOnAnswer`)

- Only the **first** `res.json` answers. A second call is dropped with a warning.
- The key is settled with the first answer's status, and that status is sent even if a later writer called `res.status()`.
- The deferred send runs only while nothing has been sent. If another writer used `res.send` / `res.end` meanwhile, the deferred answer is dropped.
- A failure of the send itself (e.g. an unserialisable body) is caught and answered with a bare 500, never left hanging. The promise chain cannot reject.
- Unchanged:
  - the settle-before-send order;
  - a failed request still frees its key (ADR-126 Am. 4);
  - the replay and conflict paths, which never wrap `res.json` and already caught their errors.
- **Process policy kept** (ADR-127 Am. 5): an unhandled rejection still shuts the process down. The fix belongs at the source.

## Audit of the middleware's other paths

- The header check and the conflict answer are synchronous, single writes.
- The replay path's `options.read` error is caught and goes to `next(err)` (one writer: `errorHandler`).
- `discardUpload` swallows its own errors.
- `fileHash`, `beginIdempotentRequest` and `scopeOf` errors are caught and go to `next(err)` before any answer.

No other double-write or rejection path was found.

## Tests (named)

- `middlewares/idempotency.doubleWrite.test.ts` (new): over a REAL Express app and HTTP server, with the real middleware, `asyncHandler` and `errorHandler`; the key service and the permission read are doubled.
  - **Covered:** 400, 409 and 500, each sent twice under the same key; a handler that writes twice; a second direct writer; a settle failure; an unserialisable body; a success.
  - **Asserted every time:** ONE parseable answer with the first status, the key settled once with that status, and **no `unhandledRejection`**.
  - **Fail-before:** run against the old middleware (`git show HEAD:…`, swapped back by hand, no stash), it gave **7 failed of 7**, with "Cannot set headers after they are sent to the client".
  - **After the fix:** 7 passed of 7.
- Every suite that reaches the middleware: 40 suites, 672 tests passed. They are the idempotency suites, the IPM session, submit and route suites, and every attachments and calibration-devices route suite. `idempotency.middleware.ts` is at 100 / 100 / 100 / 100.
- Guards (`src/tests/guards`, `utils/rawSql*`, `services/unboundedFindAll`): 44 suites, 335 tests.
- Gates:
  - `eslint` on the changed files: clean
  - `eslint-ratchet`: 0 / 0
  - `typecheck`: 0 errors
  - `ratchet`: 695
  - `load:check`: OK in dist and src
- **Not done:** a live check on a throwaway compose stack that the container survives. This card ran no image build; the coordinator's stack is the place to re-run the reproduction. **Done since, 2026-10-13:** [live verification record](./2026-10-13-live-verification-debt.md).

## Files

- `backend/src/middlewares/idempotency.middleware.ts`
- `backend/src/tests/middlewares/idempotency.doubleWrite.test.ts` (new)
- `MEMORY/DECISIONS.md` (ADR-127 Am. 5), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`

# 2026-09-29 — A-296: a multipart body is sanitized like its JSON twin; `errorLog` removed

**ADR:** none — the sanitizing model is unchanged (see "Decision" below) · **Audit:** A-296 (TASKS/AUDIT-2026-09-REMEDIATION.md) · **Found by:** the P9-19 helper, live ([2026-09-29-p9-19-middlewares-round1.md](./2026-09-29-p9-19-middlewares-round1.md) § Found, not fixed) · **Tree:** HEAD `ce74932` plus uncommitted parallel work (P9-12 lead, P9-19 helper, P10 lane, security and UI-correctness agents).

## The defect

`globalSanitizer` is mounted app-wide in `index.js`, after the body parsers and before the routers. JSON and urlencoded bodies are parsed by then, so every string in them is passed through `xss()`. A `multipart/form-data` body is parsed **later, by multer inside the route** (`utils/upload.util#upload`, `#uploadMulti`, and `ai.route.js`'s own multer). By then the sanitizer has already run on the empty `{}` that `bodyDefault` put in its place. Every multipart field therefore reached the controller exactly as sent. A tenant renamed to `<script>…` through `PATCH /tenants/edit` as form-data was stored raw. The same request as JSON was stored escaped.

## The fix: one rule for every body, applied where the body appears

| File | Change |
|---|---|
| `src/middlewares/globalSanitizer.middleware.ts` | The body branch is now a function, `sanitizeParsedBody(req)`, moved out of `globalSanitizer` unchanged: the same double read of `req.body`, reassigned to a fresh object. `globalSanitizer` calls it, so the JSON path does exactly what it did before. It is exported after `globalSanitizer`, so the existing key order is kept |
| `src/utils/upload.util.ts` | `upload()` and `uploadMulti()` call `sanitizeParsedBody(req)` as soon as multer succeeds, before the magic-byte and quarantine steps. New `uploadToMemory({ field?, maxFileSize })` is multer's `memoryStorage().single(field)`, followed by the same call. A multer error is passed on untouched, and the handler is named `multerMiddleware` as multer names its own |
| `src/routes/api/ai.route.js` | `POST /ai/ocr` uses `uploadToMemory({ maxFileSize: 5 MB })` instead of a private `multer(...)`. The limit, the field name, `req.file.buffer` and the chain order (gate, upload, controller) are all unchanged |
| `src/tests/routes/uploadAfterGate.a78.test.js` | Its source scanner now also recognises `uploadMulti(` and `uploadToMemory(` as upload handlers, so `ai.route POST /ocr` is still found and reviewed |

**What makes it hard to forget.** Multer is now imported only in `upload.util.ts`, and `guards/multipartSanitizer.a296.guard.test.ts` holds that rule for all of `src/` (tests excepted) and `index.js`. A route that loads `multer`, `busboy`, `formidable`, `multiparty` or `express-fileupload` fails the build. Inside `upload.util.ts`, every multer parse site (`uploader.single|array|fields|any|none(`) must reach `sanitizeParsedBody(req)` before its `next()`.

**What was not changed:**
- `globalSanitizer`'s mount point.
- The `xss` options and `EXCLUDED_FIELDS`. A multipart `signature` or `avatar` field is still exempt, exactly as it is in JSON.
- Query and params, which multer does not touch.

## Decision: keep sanitize-on-input, and make it uniform

The question was whether input sanitizing is the right model at all, or whether output encoding should replace it. Output encoding is the correct primary defence, and most sinks already have it:
- **The web UI:** React escapes text.
- **Email:** `email.service.ts#escapeHtml` escapes every interpolated value.
- **CSV:** `reporting.service.ts#csvEscape` quotes values and neutralises formulas.
- **Certificate PDFs:** since M-11 (ADR-095) the frontend renders them from data (`certificateDocument.service.ts`).

The input sanitizer is therefore defence in depth. It is also a known source of damage: a legitimate `<` is stored as `&lt;`, and an email that escapes it again shows `&amp;lt;`.

We did **not** remove it. Removing it would change the JSON behaviour every stored row was written under, the task forbade that, and it would need an ADR plus a data decision about already-escaped rows. Leaving the gap was the worst option: a filter that one content type skips protects nothing, because an attacker picks that content type, while honest JSON users still get their data mangled. So this change keeps the model and makes it **uniform**: every body gets the same treatment whatever its content type. **No ADR**, because the model did not change.

If the owner later wants output-encoding-only, that is an Open Question with a data migration attached. It is not raised here.

## `errorLog`: removed, not mounted

`accessLog.middleware.ts` exported `errorLog`, a second morgan instance with the **same format and the same rotating stream** that skipped status < 400. `index.js` never mounted it.

Mounting it would add nothing but a duplicate line: `accessLog` already writes every 4xx/5xx to that same file, with the same format, and errors themselves are logged through winston by `errorHandlers`. It would also be a behaviour change (flagged by the P9-19 helper). It was **removed**, with a comment in its place.

Its test changed with it. `accessLog.test.js` now asserts one morgan instance and that `accessLog` is the only export. The two `errorLog` skip-predicate tests were deleted along with the code they tested.

## Evidence

**Fail-before (original code).**
- `routes/multipartSanitizer.a296.test.ts` failed on both multipart cases before the fix. The name was stored as `<script>alert("x")</script>Acme <img src=x onerror=alert(1)>`, while the JSON twin was stored as `&lt;script&gt;…`.
- The JSON case passed. It pins the existing behaviour.

**Plant: the `sanitizeParsedBody` call removed from `upload()`, restored after, checked with `cmp`.** 4 tests failed:
- guard › every multer parse site is followed by `sanitizeParsedBody(req)`;
- guard › `/upload`;
- route › the stored value is escaped and byte-identical to the JSON twin;
- route › the response echoes the escaped value.

**New tests (TypeScript):**
- `src/tests/routes/multipartSanitizer.a296.test.ts` (3 tests) sends real HTTP requests (node `fetch` + `FormData` to a listening server). supertest is not a dependency of this workspace.
  - The chain follows index.js order: parsers, `bodyDefault`, `globalSanitizer`, the **real** tenant router, real `upload()` and multer, controller, service and audit, on `memoryDb`.
  - It asserts that the multipart-stored `name` equals the JSON-stored one, `xss(payload)`.
- `src/tests/guards/multipartSanitizer.a296.guard.test.ts` (8 tests) covers:
  - the parser-import rule;
  - the parse-site/sanitize pairing;
  - `upload()`, `uploadMulti()` and `uploadToMemory()` through real multer, each equal to the JSON path and returning a plain-prototype body;
  - `uploadToMemory` still delivers the file in memory, and still passes on `LIMIT_FILE_SIZE`;
  - `sanitizeParsedBody` on an absent body, a string body and a null-prototype body.

**Affected suites: 39 run, 36 passed, 612 tests passed.** They included:
- `globalSanitizer.test`, `accessLog.test`, `accessLog.init.test`;
- `utils/upload*`, `maxFileSize.envFallback.p701`;
- `routes/ai.*` (`ai.gate.a94` still sees `multerMiddleware` at index 1), `tenant.*`, `user.avatar.a93`, `content.media.s01`, `fileServing.s01`, `attachments*`, `routeGuards*`;
- `quarantineSweep.s33`, `tenant.controller`.

Then `uploadAfterGate.a78` was fixed (above) and passed on a rerun.

**Failing suites that are not this change:**
- `denyPlatformAuthoring.a127` lists new `accessRequests.route.ts POST /` and `admin.route.js POST /access-requests/:id/approve`.
- `twoTenantRoutes.guard` lists new `admin.route` `/tenants/:id/sso-domains` and `/access-requests/:id…` routes.

Both come from other agents' in-flight routes. Neither names a file changed here.

**Boundary checks:**
- **ESLint:** 0 errors on every changed file. The one warning is pre-existing: `accessLog.test.js:32`, an unused `time` in a mock.
- **Typecheck:** no error in any file changed here. The errors it does report are in other agents' in-flight files: `auth.service.ts`, `loginDiscovery.service.ts`, `apiKeyAuditPrincipal.a282.guard.test.ts` and `migrations/0098-*.test.ts`.
- **`npm run ratchet`:** passed. It lowered the floor 968 → 966 for `.js` files other agents removed. This change adds no `.js` file.

**Full `npm run test:coverage -- --ci`:** see the addendum below.

## Found, not fixed

- **A-303 — since fixed, see [2026-09-30-a303-tenant-profile.md](./2026-09-30-a303-tenant-profile.md). `address` is written by `tenant.service#updateTenant` (line 798), accepted by `updateTenantSchema`, and is not a Tenant model attribute.** The same is true of `description`, `phone`, `city`, `state`, `zipCode`, `country` and `website`: `models/tenant.model.ts` defines none of them. Sequelize drops every one, so the tenant edit form's contact fields are silently never stored. This is the A-295 / Q-35 defect class. It was found because the twin test first used `address`. Not fixed here; it is a separate data decision (add the columns, or stop accepting the fields).

## Addendum — full `npm run test:coverage -- --ci` (2026-09-30, a busy tree; not green, and not from this change)

- **Result:** 638 of 773 suites passed, 109 failed, 26 skipped; 12,866 tests passed, 110 failed. All files: 94.82 / 91.27 / 92.98 / 94.82.
- **The four source files changed here are each at 100/100/100/100:**
  - `upload.util.ts`
  - `globalSanitizer.middleware.ts`
  - `accessLog.middleware.ts`
  - `ai.route.js`
- **What the failures are:** almost all are "Test suite failed to run" with `ENOENT … services/auth.service.js`, 110 occurrences. Another agent was converting `auth.service` to `.ts` during the run, so every suite that loads `auth.middleware` failed to load. The others:
  - a missing `docs/swagger` (8);
  - `contentMedia.service.js`;
  - two migrations (`0047`, `0049`) moved by P9-23.
- **`ai.gate.a94` was among them** (same ENOENT). A rerun after the run finished passed all 173 tests of the suites this change touches:
  - both A-296 suites;
  - `globalSanitizer`, `accessLog*`, `utils/upload*`;
  - `routes/ai.*`, including `ai.gate.a94`;
  - `uploadAfterGate.a78`, `tenant.logo*`, `user.avatar*`.

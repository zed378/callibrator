# Feature Spec — P9-11 The Validation Error Contract (Joi → Zod)

**Written:** 2026-09-28, **before** implementation (no validator has been converted)
**Task:** P9-11 (`TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`)
**Author:** Phase 9 helper 3 (Claude)
**Spec refs:** ADR-038 (runtime validation row: Zod; shared contracts row) · ADR-087 decision 7 (types in `src/types/`) · `docs/BACKEND/03-VALIDATION.md` · `docs/API/00-API-STANDARDS.md` § Validation and § Error · `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` § Request data comes from Zod · CLAUDE.md § The Response Envelope, § The Traps
**Read from code:** `middlewares/validation.middleware.js`, `utils/response.util.js`, `utils/controllerWrapper.util.js`, `middlewares/errorHandlers.middleware.js`, `utils/fileValidation.util.js#sanitizeError/isExposableError`, the 40 files in `validators/`, `frontend/src/api/client.ts`
**Pinned by:** `backend/src/tests/contracts/validation/` (41 suites, 82 tests, added with this spec)

> A contract spec, not a feature. The Data Model and UI sections of the template have no
> content here. **Nothing is converted.** Every statement about today's behaviour is pinned by a
> named test in `tests/contracts/validation/`. Every statement about Zod is a proposal. Where
> one was typechecked, the section says so.

---

## Problem

ADR-038 replaces Joi with Zod, so that one schema is both the runtime check and the handler's
request type. The P9-11 card's DoD requires the 400 to stay **byte-compatible**: "same status,
same envelope, same message format, asserted by a contract test per validator". Nobody had
written down what that 400 *is*. It turns out there is not one validation 400 but **five
surfaces** (below), and the documentation describes a sixth that does not exist.

## What `docs/` and the ADRs already decide

| Decision | Source |
|---|---|
| Zod replaces Joi module by module. The schema is the single source of the runtime check **and** the request type | ADR-038, runtime validation row |
| `validate(schema)` writes the parsed result to `req.validated`. Controllers read `req.validated`, never `req.body` | 04-TYPESCRIPT-STANDARDS § Request data |
| `z.any()` and `.passthrough()` in a request schema are validation switched off | 04-TYPESCRIPT-STANDARDS § Things That Look Strict; P9-11 abuse case |
| The envelope is `{ success, status, message, data }`, and `details` appears **only when `NODE_ENV !== "production"`** | 00-API-STANDARDS § Error; `response.util#error` |
| `joi` leaves `package.json` only after the last validator moves | P9-11 DoD |
| Shared request/response schemas used by the frontend go in `packages/contracts` | ADR-038 shared contracts row; **P9-22** |
| Backend-internal shared types (the request context, `ApiResponse<T>`) go in `src/types/`. `express.d.ts` is there. `ApiResponse<T>` lands with `response.util`'s conversion | ADR-087 decision 7 |

### Where `docs/` is wrong (as-built, 2026-09-28)

| `docs/` says | The code does | Pinned by |
|---|---|---|
| 03-VALIDATION § Error Shape: `"message": "Validation failed"` | `validate(schema)` answers **`"Validation Error"`**. `"Validation failed"` is what the per-file helpers throw (surface C) | every `*.validator.contract.test.ts` |
| same: `details: [{ "field": "serialNumber", "message": "is required" }]` | the message is Joi's full text **with the label quoted**: `"\"serialNumber\" is required"` | same |
| same: "The frontend maps field detail back to form fields" | `frontend/src/api/client.ts:246` reads `message` (or `error`) and nothing else. **No frontend code reads `details`** (grep of `frontend/src`, tests excluded) | — (read, not tested) |
| 03-VALIDATION § Path Parameters: `validate(schema)({ ...req.params, ...req.body })` | `validate(schema)` validates **`req.body ?? {}` only**. The params merge happens in **controllers**, which call a file's own `validate(data, schema)` helper | `middleware.contract.test.ts` › "a path parameter is NOT merged in" |
| 03-VALIDATION: "37 validators" | **40** files (`ls backend/src/validators`) | the 40 per-validator suites |

These are docs amendments for the docs owner, through the deviation protocol. This spec records
them and does not edit `docs/`.

---

## The contract today: five surfaces

### Surface A — `validate(schema)` from `middlewares/validation.middleware.js` (the one the card means)

Mounted by 21 route files. It runs `schema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true })`.

**Outside production** (`NODE_ENV !== "production"`, read per call), the answer is HTTP 400 with
`content-type: application/json; charset=utf-8` and a body that is **exactly**:

```
{"success":false,"status":400,"message":"Validation Error","data":null,"details":[{"field":"<path joined by .>","message":"<Joi message>"}, …]}
```

**In production** the body is exactly:

```
{"success":false,"status":400,"message":"Validation Error","data":null}
```

The pinned properties:

- **Key order is part of the bytes**: `success, status, message, data, details`.
- **`details` order** is Joi's report order: schema key order, every failure (`abortEarly: false`).
  A single key can produce **two** entries. Example from `vendor` `qualifyVendor`: an object
  value gets both `"approvalStatus" must be one of [APPROVED, PENDING, REJECTED, CONDITIONAL]`
  and `"approvalStatus" must be a string`.
- **`field`** is `path.join(".")`. An object-level rule gives `field: ""`. Example from
  `billing` `updateSubscription`:
  `"value" must contain at least one of [planId, status, billingCycle]`.
- **`message`** is Joi's text, label quoted, **or** the schema's own `.messages()` override,
  label unquoted. Examples: `customDomains`: `Domain is required`; `notification`:
  `ids is required`.
- **A bodyless request** (Express 5 sets `req.body` to `undefined`) is validated as `{}`, so the
  required rules fire (A-09).
- **On success**, unknown keys are stripped, `req.body` is **replaced** by the stripped value,
  and the query string and path parameters are **not** seen.

What the frontend actually depends on: the status, and `message` (`"Validation Error"`), because
`client.ts` shows it to the user. `details` is read by no frontend code.

### Surface B — `validateBody` / `validateQuery` from `validators/meteredBilling.validator.js`

This is a **second live validation middleware**. `meteredBilling.route.js` mounts it four times.
It calls `next(err)` with an `Error` carrying `status: 400`. The central `errorHandler` answers,
through `sanitizeError`, so the envelope is **different**: no `data`, a `requestId`, and the
messages **joined into one string**.

- **Outside production**, the key order is `success, status, message, stack, name, requestId`,
  and the message is `"metricName" is required, "threshold" is required`.
- **In production** the body is exactly
  `{"success":false,"status":400,"message":"An unexpected error occurred. Please try again later.","requestId":"unknown"}`.
  The message is **generic** because a plain `Error` with a 4xx is not "exposable"
  (`fileValidation.util#isExposableError`). **A metered-billing validation failure in
  production tells the caller nothing.** That is a defect by the standard of the other
  validators. It is pinned as-is and recorded here, not fixed (rule 3).

Pinned by: `meteredBilling.validator.contract.test.ts` (two `validateBody` tests).

### Surface C — each file's own `validate(data, schema)` helper, called by controllers

32 of the 40 files export a helper, in **four** shapes. The per-validator suites pin the output of
each file's helper:

| Shape | Files | What the controller receives |
|---|---|---|
| returns Joi's `{ error, value }` (the controller maps it, often with the file's `formatErrors`) | audit, auth, billing, calibrationDevices, calibrationRecords, finance, iot, maintenance, menuGroup, notification, roles, session, sso, stock, tenantBackup, user, vendor, warehouse | Joi's `details`. `formatErrors` gives `[{ field, message }]` |
| throws `{ status: 400, message: "Validation failed", errors: [{ field, message }] }` | certificate, tenant | a plain object |
| throws `{ status: 400, message: "Validation failed", errors: { <first path segment>: message } }` | dataRetention, featureFlag, networkSecurity, oidc, scim, tenantLifecycle, webauthn | a plain object. **One message per top-level key**; later messages for the same key overwrite earlier ones |
| throws `new Error(<messages joined ", ">)`, **no status** | customDomains, eSignature, gdpr, meteredBilling, tenantHierarchy | an `Error`. **None of these five helpers is called by any route or controller** (grep). The routes use surface A |

`audit.validator` and `webauthn.validator` export **no schema**, and nothing in `backend/src`
imports either of them. Their suites pin the helpers against a local schema. Deleting either file
is its own change.

### Surface D — a surface C throw, answered by `asyncHandler`

This is the path the params-merging controllers use: `tenant`, `dataRetention`, `featureFlag`,
`tenantLifecycle`, `user` and others. `asyncHandler` → `sendCaughtError` →
`response.util#error(res, message, status, error.stack || String(error))`.

For a thrown **plain object**:

- **outside production**:
  `{"success":false,"status":400,"message":"Validation failed","data":null,"details":"[object Object]"}`;
- **in production**: `{"success":false,"status":400,"message":"Validation failed","data":null}`.

**The `errors` field never reaches the wire on this path.** `sendCaughtError` passes no `extra`,
so the field-level detail the helpers build is thrown away. Outside production, `details` is the
string `"[object Object]"`. A thrown `Error` with no status would be a 500. No live route
reaches one today (surface C, last row).

Pinned by: `middleware.contract.test.ts` › "a validator helper's throw, sent by asyncHandler"
(two tests, through the real `asyncHandler` and the real `tenant.validator` helper).

### Surface E — direct `schema.validate` calls outside `validators/`

- `controllers/menuGroup.controller.js#validate` throws `AppError(400, "Validation failed: " + messages.join(", "))`.
- `controllers/tenantHierarchy.controller.js:103` throws `AppError(400, formatErrors(details) || "Validation failed")`, using `appError.util#formatErrors`, a **string**.
- `services/calibrationDeviceReinstate.service.js:97` calls its own schema.

Each is a message format of its own. They convert with their controllers and services (Stages
C and D), **not** with P9-11. They are listed so that nobody assumes P9-11 covers them.

---

## How the Zod conversion reproduces surface A byte for byte

### The oracle

**The 41 suites in `tests/contracts/validation/` must pass unchanged.** Every expectation in them
is a literal (see *Evidence* for how the literals were recorded).

- A conversion may change a suite's **import** of the schema. It may not change the body.
- A suite that has to change is a **contract change**. It needs an ADR entry and a named
  frontend impact, not an edit in the conversion PR.

Each suite drives the middleware through `harness.ts`: a real Express 5 app, `express.json()`,
the real `errorHandler` and a real fetch. The harness's `ValidatorSchema` type is
`Parameters<typeof validate>[0]`. It therefore follows whatever `validate()` accepts after the
conversion.

### What Zod does differently, and what has to be written to close the gap

Probed with Zod 4.6.5. It is present in the root `node_modules` as a **transitive** dependency;
no `package.json` in the repository declares it, so P9-11 adds it to `backend/package.json`.

| Joi today | Zod 4 default | Consequence |
|---|---|---|
| `"email" is required` | `Invalid input: expected string, received undefined` | the defaults differ for every issue kind |
| `"username" length must be at least 3 characters long` | `Too small: expected string to have >=3 characters` | same |
| `"approvalStatus" must be one of [APPROVED, PENDING]` | `Invalid option: expected one of "APPROVED"\|"PENDING"` | same |
| two entries for one key (`vendor`: `any.only` and `string.base`) | one issue per key | **not reproducible by mapping alone** |
| `.messages({ "any.required": "Domain is required" })` | per-schema `error:` customisation | expressible in Zod |
| object-level `.or()`: `field ""`, label `"value"` | `.refine()` on the object: path `[]` | reproducible |
| `convert: true` (the default): `"5"` passes `Joi.number()` as `5` | `z.number()` refuses `"5"`; `z.coerce.number()` converts | **a value difference, not a 400 difference.** Each query/number field must be decided, and the per-file helper suites plus the service tests catch it |
| `stripUnknown: true` | `z.object` strips unknown keys by default | same behaviour. `.strict()` would be a behaviour change |

The pattern, one module, `middlewares/validation.middleware.ts`:

1. **`formatIssue(issue): { field, message }`** reproduces Joi's templates from Zod's issue
   codes. Joi's quoted label is the last path segment, or `"value"` at the root.
   - The codes the 40 files need: `invalid_type` / missing → `is required` or
     `must be a <type>`; `too_small` / `too_big` for strings, numbers and arrays; `invalid_value`
     → `must be one of [...]`; `invalid_format` for `email`, `uuid` and `uri`; `custom`, which
     carries its message verbatim.
   - The Joi templates to copy are Joi's own message table (`joi/lib/types/*.js` `messages`),
     **not** memory.
2. **A schema-level `.messages()` override becomes the Zod schema's `error`.** The contract
   suites for `customDomains` and `notification` hold it.
3. **`details` keeps Joi's order.** Zod reports issues in schema key order for `z.object`, which
   matches. Where Joi reports two issues for one key and Zod reports one (`vendor`
   `qualifyVendor`), the conversion either reproduces both, with a `superRefine` that adds the
   second issue, or records the change (*Open questions* 1).
4. The envelope comes from `response.util#error`, **unchanged**: same call, same arguments. The
   middleware never builds its own JSON.

### `validate()` and the params merge

- **Today the middleware validates `req.body` only.** Merging `req.params` into the middleware
  would change which keys reach `req.body`, and which errors a request produces. That is a
  **behaviour change**, so it is **not** part of P9-11's conversion.
- The card's "`validate(schema)` merges `{ ...req.params, ...req.body }`" is therefore
  implemented **additively**. `validate()` keeps writing the stripped body to `req.body`,
  exactly as today, and **also** writes `req.validated`, typed as `z.infer<S>`, parsed from a
  **declared** source:
  `validate(schema, { from: "body" })` is the default; `{ from: ["params", "body"] }` is opt-in.
- **Merge precedence is a finding, not a settled choice.** The controllers disagree:
  - `tenant.controller` spreads `{ ...req.body, ...req.params }`: **the path wins**;
  - `dataRetention`, `featureFlag` and `tenantLifecycle` spread
    `{ ...req.params, ...req.body }`: **the body wins**.

  On `PUT /tenants/:tenantId/policy` (super-admin-only), `checkTenant` checks the **path**
  `tenantId`, but the service acts on the **body's** `tenantId` when one is sent.
  - Low severity (super admin only), but the audit row and the checked tenant can differ.
  - **Proposed rule for `req.validated`: the path wins** (identity comes from the URL the gate
    checked).
  - Adopting it on the three body-wins controllers is a behaviour change. It is an
    `AUDIT-2026-09` item of its own, not part of P9-11.
- `req.validated` is declared in `src/types/express.d.ts`, which already exists, as the standard
  shows (`validated?: unknown`). It is narrowed by a typed handler helper, not by a cast.

### Making `schema.validate`-as-middleware unrepresentable

The two halves were **typechecked** (scratch `p9h3/zod/trap.ts`, TypeScript 7.0.2 under
`backend/tsconfig.json`):

- In a **`.ts` route**, `router.post("/a", schema.parse, ok)` fails to compile, and so do
  `safeParse` and `parseAsync`. The error is TS2769, "Type 'Request<…>' has no properties in
  common with type 'ParseContext<$ZodIssue>'" (weak-type detection). The typed
  `validate(schema)` returning `RequestHandler` compiles.
- **But the routes stay JavaScript until P9-21 (Stage D)**, and a `.js` route passing
  `schema.parse` compiles, runs, and answers 500 on every request, like the Joi trap today. For
  the interval, the guard is a **source test**: an existing route guard (the scanner in
  `routePermissionGuard.p604` or `swaggerValidatorAlignment.p608`) extended to fail on a
  `.parse` / `.safeParse` / `.parseAsync` / `.validate` member expression passed to a router
  method. It needs a bite test.
- **`validate()` is the only exported way to use a schema as middleware.**
  `meteredBilling.validator`'s `validateBody` / `validateQuery` (surface B) are **the one other
  way today**. Folding them into `validate()` changes surface B's wire, which P9-11 has to
  decide (*Open questions* 2).

### Where the Zod schemas live

ADR-038 puts the shared schemas in `packages/contracts` (P9-22, which depends on P9-11).
`TASKS/BACKLOG.md` and `DECISIONS.md` contain **no Q-29**. ADR-087 decision 7 notes that the
coordinator cited one that was never written. Proposed:

- P9-11 keeps each Zod schema in its `validators/<x>.validator.ts`;
- P9-22 moves the frontend-facing ones.

That is what the dependency order already implies. Whether a separate "contracts location"
question exists is left to the owner: this spec neither creates nor settles it.

---

## Security

- **`tenantId` from a body.** Several schemas require `tenantId` because the controller merges
  path parameters into what it validates. With `req.validated` parsed path-wins (above), a body
  `tenantId` can never override the path. Until then, the body-wins controllers stay as they are
  and the finding stays in this spec.
- **Production reveals less than it looks.** Surface A omits `details` in production. Surface
  B's message is generic. Surface D's `errors` is dropped everywhere. None of these leaks schema
  internals. A Zod conversion must not start sending Zod's own issue objects: they carry
  `expected`/`received` and, for unions, nested issue trees.

## Tests (named)

- `backend/src/tests/contracts/validation/<file>.validator.contract.test.ts`: one per file in
  `validators/`, 40 suites.
  - 38 drive `validate(schema)` with a real exported schema and an invalid payload, in both
    modes, and assert status, content type and body **text**.
  - 30 of them also pin the file's own helper (surface C).
  - `audit` and `webauthn` have no schema, and pin their helpers.
  - `meteredBilling` also pins surface B in both modes.
- `backend/src/tests/contracts/validation/middleware.contract.test.ts` pins:
  - the bodyless-as-`{}` behaviour;
  - strip-and-replace on success;
  - params not merged, and the query string not seen;
  - surface D in both modes.
- `backend/src/tests/contracts/validation/harness.ts`: no test, the shared driver.
- The existing `tests/validators/*.validator.test.js` (unit, mocked responses) and
  `bodylessBody.a09.test.js` stay. **`bodylessBody.a09.test.js` reads `.js` only**
  (`f.endsWith(".js")`, line 50), so a converted validator silently drops out of it. It must
  read `.ts` in the first P9-11 merge. The same is true of `swaggerValidatorAlignment.p608.test.js`
  (line 56).

## Traps to avoid

- [x] `validate(schema)`, never `schema.validate`: typed away in `.ts` routes; a source guard for `.js` routes until P9-21.
- [x] `{ ...req.params, ...req.body }`: additive, opt-in, path-wins, and never inside the conversion.
- [ ] **New:** Zod's default messages differ from Joi's for every issue kind. A "passing" conversion that updates the contract literals is a contract change, not a conversion.
- [ ] **New:** `z.number()` without `coerce` refuses `"5"` where Joi converted it. That is a value change on every query schema.
- [ ] **New:** guard tests that walk `.js` only (`bodylessBody.a09`, `swaggerValidatorAlignment.p608`).

## Open questions (for the owner)

1. **How strict is "byte-compatible" for `details`?** Only non-production responses carry it,
   and no frontend code reads it. Full byte compatibility of every Joi message costs a
   Joi-template formatter and a `superRefine` for the double-issue cases. The cheaper
   alternative is to hold status, envelope, `message` and the `details` item **shape**, and let
   the message text change, with the suites updated **once** under an ADR.
   **Recommendation: full compatibility**, as the card says. The formatter is one module, and
   the suites make it checkable.
2. **Surface B** (metered billing): keep its separate envelope and generic production message,
   or fold it into `validate()` (a visible fix: production would then say `"Validation Error"`)?
   Either choice is a decision, and the suite pins today's answer.
3. **Surface D's lost `errors`**: an existing defect (the helper builds field detail that the
   wire drops). Proposed as an `AUDIT-2026-09` item. Not P9-11.
4. The docs amendments listed under *Where `docs/` is wrong*.

## Evidence

- **The contract suites pass.**
  `npm test -- src/tests/contracts/validation --coverage=false` gave **41 suites, 82 tests, all
  passed**, and they also ran inside the full `npm run test:coverage` (see the change record).
- **How the literals were recorded.** They were written by a scratch generator (`p9h3/gen.js`)
  from a run of today's validators: the first object schema of each file that fails on `{}`, or
  else on a wrong-typed key. They were then reviewed by eye, and a mismatch in the
  meteredBilling expectation (one assumed message against two actual) was found and corrected.
  **They pin today's behaviour; they do not assert that it is right.** CLAUDE.md's "a test
  generated from the code verifies consistency" applies deliberately: consistency with today is
  what a behaviour-preserving conversion needs.
- **The suites bite.**
  - What was done: a scratch copy of `user.validator.js` with **one** message changed
    (`username`'s `any.required` → `"Username is required"`) was substituted through
    `jest.mock` for the real module. The **unchanged** `user.validator.contract.test.ts` was then
    run against it.
  - Result: **2 failed of 2**. The body text differs in exactly that one `details` entry, and
    the helper pin differs in the same message.
  - The repository's validator was not edited.
- **Typecheck:** `npm run typecheck` exit 0. **ESLint:** `npx eslint src/tests/contracts/validation` gave 0 problems. **Ratchet:** `npm run ratchet` passes (all new files are `.ts`).
- **The Zod trap, typechecked** (`p9h3/zod/trap.ts`): TS2769 × 3 for `schema.parse` /
  `safeParse` / `parseAsync` as Express middleware; the typed `validate(schema)` compiles.

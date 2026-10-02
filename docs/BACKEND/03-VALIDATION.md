# 03 — Validation

> **Language status (as-built 2026-10-02).** The backend's source is **TypeScript, strict** (ADR-038; the toolchain is ADR-087), compiled to CommonJS and run from one `dist/` tree. The only source `.js` file left is the dead `utils/checkMenu.util.js`, awaiting deletion (A-18); `noSourceJs.p924.guard` fails on any other. The **694 `.js` files in the test trees are legacy JavaScript** (682 test files and 12 fixtures and helpers, `src/tests/` and `__tests__/`, counted 2026-10-02), converted opportunistically under P9-26; **all new code, tests included, is TypeScript** (`npm run ratchet` refuses a new `.js` file). The rules are [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../ENGINEERING/04-TYPESCRIPT-STANDARDS.md). Behaviour described here is **as-built** unless marked *target*. The validation layer is ADR-093 (Zod; Joi removed); its spec is [`MEMORY/specs/P9-11-validation-error-contract.md`](../../MEMORY/specs/P9-11-validation-error-contract.md).

**Zod** (ADR-093, P9-11 — Joi was removed on 2026-09-29). 39 validator modules in `backend/src/validators/` (`*.validator.ts`), with the shared field schemas in `fields.ts` and the one input helper in `input.ts`, applied by `validate(schema)` from `middlewares/validation.middleware.ts`. These modules are TypeScript: `z.infer<typeof schema>` is the request type.

---

## Use `validate(schema)`, Always

```js
router.post("/", validate(createSchema), controller.create);   // ✓
router.post("/", createSchema.parse, controller.create);       // ✗ throws on EVERY request
```

`validate(schema)` returns middleware; it is the **only** way a schema reaches a router. Passing a schema's own method (`parse`, `safeParse`, or the old `validate`) means Express calls it as `(req, res, next)`. In a `.ts` route that is a compile error (TS2769); `.js` routes are held to it by the source guard `tests/guards/schemaAsMiddleware.p911.test.ts`.

Outside a route, controllers and services check input with `validators/input.ts` — `validateInput(data, schema)` (returns the parsed value or throws `{ status: 400, message: "Validation failed", errors }`) and `checkInput(data, schema)` (`{ ok, value }` / `{ ok: false, errors }`). No validator module has a helper of its own (guard: `tests/validators/bodylessBody.a09.test.js`).

## Path Parameters Must Reach the Validator

```js
// the identifier arrives in req.params, NOT req.body — declare the sources
router.put("/:tenantId/policy", validate(policySchema, { from: ["params", "body"] }), ctrl.setPolicy);
```

`validate(schema)` reads `req.body` only (an absent body is checked as `{}`). With `{ from: [...] }` it checks the merge of the declared sources, and **a path parameter always wins** over a body or query key of the same name — the path is what the permission and tenant gates checked. The result is on `req.validated` (read it typed with `validated(req, schema)`); `req.body` is replaced only when the source is the body.

*As-built:* the controllers listed below still merge by hand with `validateInput({ ...req.params, ...req.body }, schema)`, where **the body wins** — AUDIT A-273.

Several endpoints validated `req.body` for an identifier that only ever arrives as a path parameter, and **400ed every request**.

This recurred across three modules, so it is a pattern rather than a slip:

| Endpoint | Path parameter validated in the body |
|---|---|
| `POST /feature-flags/:tenantId/:flagKey` | both |
| `POST /tenants/:tenantId/suspend` | `tenantId` |
| `PUT /tenants/:tenantId/policy`, `/mask-pii`, `/anonymize` | `tenantId` |
| `POST /tenants/:tenantId/legal-hold` | `tenantId` |

When adding an endpoint with both path parameters and a body, check which one the validator reads.

## A Missing Validator Surfaces as a 500

A bad enum value reaching the database produces a **500, not a 400** — and that sends the investigation to the wrong layer entirely.

`PATCH /qms/nc/:id` with an invalid status 500ed for exactly this reason: no body validator, so the bad value hit the column constraint. Adding `qms.validator` made it a 400.

**A 500 from a bad input value is always a missing validator.**

## What to Validate

| Input | Validate |
|---|---|
| Body | shape, types, required fields, enum membership, ranges |
| Query | pagination, filters, sort fields |
| Params | UUID format — plus `validateUuid` |
| Headers | only where they carry data |

### Enums must be validated

Every ENUM column has a fixed value set. The validator enumerates them so a bad value is a 400 with a useful message rather than a 500 from the database.

```ts
status: z.enum(["draft", "pending_approval", "approved", "signed", "revoked"])
```

The D-26 guard (`tests/models/enumMirrors.d26.test.js`) holds every enum a validator declares to the model's ENUM.

### Never accept `tenantId` from the body

```ts
// simply absent from the schema: unknown keys are stripped
```

`tenantId` is stamped from the `AsyncLocalStorage` context by the global hooks. A body-supplied tenant id is an obvious cross-tenant write attempt, and the way to make it impossible is to never read it.

The same applies to `performedBy`, `createdBy`, `uploadedBy` and every other attribution column — they come from `req.user.id`. **Attribution a client can set is not attribution.**

## `validateUuid`

Runs before the handler, rejecting a malformed path id before it reaches the database.

Without it a malformed UUID reaches PostgreSQL and raises a type error — a 500 for what is plainly a 400.

## Global Sanitisation

`globalSanitizer.middleware.ts` runs before every route, sanitising `req.body`, `req.query` and `req.params`.

It **does not** touch `req.rawBody`, which is why the Stripe webhook signature still verifies ([`../API/11-BILLING-FINANCE-API.md`](../API/11-BILLING-FINANCE-API.md)).

Sanitisation is defence in depth, not a substitute for validation. Sanitising makes input safe to handle; validating makes it correct.

## Validation Is Not Authorization

A schema says the request is well-formed. It says nothing about whether this caller may make it.

```js
router.post("/",
  auth,                                    // who
  dynamicAccess("equipment", "write"),     // may they
  validate(createSchema),                  // is it well-formed
  controller.create,
);
```

Order matters: reject an unauthorised caller before spending effort validating their payload, and before any error message reveals the shape of the resource.

## Error Shape

A `validate(schema)` failure returns 400 with field detail:

```json
{
  "success": false,
  "status": 400,
  "message": "Validation Error",
  "data": null,
  "details": [{ "field": "serialNumber", "message": "Invalid input: expected string, received undefined" }]
}
```

`details` is included **only outside production**; `field` is the path joined with dots, and `message` is Zod's wording unless the schema overrides it (the password rule, "Passwords do not match", "Domain is required", "ids is required" and a few others the UI shows). The byte-level contract is pinned by `backend/src/tests/contracts/validation/` (ADR-093 lists every string that changed from the Joi wording).

*As-built:* the frontend reads `message` only (`frontend/src/api/client.ts`); no frontend code reads `details`.

A controller that throws `validateInput`'s `{ status: 400, message: "Validation failed", errors }` is answered by `asyncHandler` with that message, and `details` outside production is `"[object Object]"` — the field errors do not reach the wire on that path (AUDIT A-272).

## Contract Drift

**Swagger and the enforced validators disagree for the GDPR endpoints.** Documented drift, tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

The validators are the authority — they are what runs.

**Since P9-25 (ADR-103) the contract is generated from the validators themselves, route module by route module.** A route's `routes/api/<name>.openapi.ts` names the same Zod schema object its `validate()` mounts, and `npm run openapi:generate` renders it into the committed `backend/openapi.json` with `zod-openapi`. For those routes the published request body cannot drift from the enforced one. Routes not yet moved still publish their `@swagger` JSDoc (merged into the same document), and `swaggerValidatorAlignment.p608` keeps comparing those against the validators; its `KNOWN_DRIFT` list shrinks as modules move (vendor left it with the P9-25 pilot).

The document is checked, not regenerated on build: `npm run openapi:check` fails the build, the image build and CI when the committed file is not what the source generates. *(As-built until 2026-09-30: `npm run swagger:generate` rewrote `swagger.json` from JSDoc alone at build time.)*

Note on the published form: `zod-openapi` renders a request schema's **input** side. A field the validator converts (`numeric()`, `isoDate()`) is published as its canonical type (a number, an ISO date string); the validator still accepts the lenient forms. The contract is therefore stricter than the validator, never looser.

## Where Validation Cannot Reach

Some rules are not expressible per field:

| Rule | Enforced |
|---|---|
| A live provider key must not appear with `NODE_ENV != production` | a **cross-field** config rule |
| A certificate transition must be legal from the current state | the model, returning 409 |
| A purge must skip entities under legal hold | the service |
| Quota must not be exceeded | middleware, **before** the handler |

The first is the one per-field validation is structurally incapable of catching: a live Stripe key passes every shape, length and format check, and will charge a real card from a test.

## Adding a Validator

1. One schema per endpoint, or one per resource with variants.
2. Enumerate every ENUM.
3. **Forbid** `tenantId` and every attribution field.
4. Where identifiers arrive in the path, declare the sources: `validate(schema, { from: ["params", "body"] })` (the path wins).
5. Apply with `validate(schema)`, never a schema's own method.
6. A query string is text: convert explicitly, per field (`numeric`, `booleanish`, `dateLike` from `validators/fields.ts` — not `z.coerce`, which turns `""` into 0 and `"false"` into `true`).
7. Test the rejection cases, not only the acceptance case. A validator test that only proves valid input passes proves nothing.
8. No `z.any()`, `.passthrough()` or `.loose()` to make a legacy payload validate — that is validation switched off at the boundary (P9-11 abuse case; `docs/ENGINEERING/04` § Things That Look Strict). Unknown keys are stripped by `z.object`'s default; `.strict()` would be a behaviour change.
9. A validator used by a route has a contract suite in `backend/src/tests/contracts/validation/` (`<file>.validator.contract.test.ts`, driven by `harness.ts`) that pins the exact 400 body in both modes. A change to a literal there is a **contract change** and needs a record, not an edit in passing.

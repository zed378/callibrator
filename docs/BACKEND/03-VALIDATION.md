# 03 — Validation

Joi. 37 validators in `backend/src/validators/`, applied by `validate(schema)` from `validation.middleware.js`.

---

## Use `validate(schema)`, Always

```js
router.post("/", validate(createSchema), controller.create);   // ✓
router.post("/", createSchema.validate, controller.create);    // ✗ 500s EVERY request
```

`validate(schema)` returns middleware. Passing `schema.validate` directly means Express calls it as `(req, res, next)` while Joi expects a value to validate.

The same shape produced a real defect elsewhere: a controller spread a Joi schema into a plain object and then called `.validate` on the result — `schema.validate is not a function`, on every request to that endpoint.

## Path Parameters Must Reach the Validator

```js
// the identifier arrives in req.params, NOT req.body
validate(schema)({ ...req.params, ...req.body })
```

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

```js
status: Joi.string().valid("draft", "pending_approval", "approved", "signed", "revoked")
```

### Never accept `tenantId` from the body

```js
tenantId: Joi.forbidden()   // or simply absent from the schema
```

`tenantId` is stamped from the `AsyncLocalStorage` context by the global hooks. A body-supplied tenant id is an obvious cross-tenant write attempt, and the way to make it impossible is to never read it.

The same applies to `performedBy`, `createdBy`, `uploadedBy` and every other attribution column — they come from `req.user.id`. **Attribution a client can set is not attribution.**

## `validateUuid`

Runs before the handler, rejecting a malformed path id before it reaches the database.

Without it a malformed UUID reaches PostgreSQL and raises a type error — a 500 for what is plainly a 400.

## Global Sanitisation

`globalSanitizer.middleware.js` runs before every route, sanitising `req.body`, `req.query` and `req.params`.

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

A validation failure returns 400 with field detail:

```json
{
  "success": false,
  "status": 400,
  "message": "Validation failed",
  "data": null,
  "details": [{ "field": "serialNumber", "message": "is required" }]
}
```

`details` is included **only outside production**.

The frontend maps field detail back to form fields — that is what turns "validation failed" into a message beside the field that caused it ([`../FRONTEND/04-FORM-ARCHITECTURE.md`](../FRONTEND/04-FORM-ARCHITECTURE.md)).

## Contract Drift

**Swagger and the enforced validators disagree for the GDPR endpoints.** Documented drift, tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

The validators are the authority — they are what runs. Swagger is generated from annotations and can fall behind, which is worth knowing before writing a client from the spec.

`npm run swagger:generate` runs as the first step of the backend build, so the spec is regenerated on every build. A build that skips it ships a spec describing the previous version.

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
4. Merge `{ ...req.params, ...req.body }` where identifiers arrive in the path.
5. Apply with `validate(schema)`, never `schema.validate`.
6. Test the rejection cases, not only the acceptance case. A validator test that only proves valid input passes proves nothing.

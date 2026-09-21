# 01 — Coding Standards

The numbered standard. Each rule is short; the linked document has the reasoning and the examples. Cite a rule by number in review (`CS-4.2`).

> **Target standard (ADR-038).** Rules marked **[TS]** apply to TypeScript files — every new backend file and every file converted under Phase 9. All other rules apply to the backend as it is today, JavaScript included.

---

## 1. Structure

- **CS-1.1** A URL is defined only in `routes/api/*.route.*`. → [02](./02-PROJECT-STRUCTURE.md)
- **CS-1.2** Route → controller → service → model. A controller never touches a model; a service never touches `req` or `res`. → [00 §4](./00-CODING-CONTEXT.md)
- **CS-1.3** One service call per controller action. Composition belongs in the service.
- **CS-1.4** No new top-level directory under `backend/src` without an ADR.

## 2. Naming

- **CS-2.1** Files are `<name>.<layer>.<ext>` — `calibrationDevices.route.js`, `certificate.service.js`. → [03](./03-NAMING-CONVENTIONS.md)
- **CS-2.2** URL paths are kebab-case plural nouns: `/api/v1/calibration-devices`.
- **CS-2.3** Model attributes camelCase, columns snake_case — **except `sessions`**, whose attributes are snake_case.
- **CS-2.4** Webhook events are `<aggregate>.<past_tense_event>`: `device.overdue`, `certificate.signed`.

## 3. Types

- **CS-3.1** [TS] `strict` plus every ADR-038 flag. No per-file relaxation. → [04](./04-TYPESCRIPT-STANDARDS.md)
- **CS-3.2** [TS] No `any` — explicit, implicit, or via `as unknown as`.
- **CS-3.3** [TS] Identifiers crossing a module boundary are branded (`TenantId`, `UserId`).
- **CS-3.4** [TS] Every state machine is a string-literal union; every `switch` over one is exhaustive.
- **CS-3.5** [TS] Exported functions declare their return type.
- **CS-3.6** JavaScript files carry JSDoc on every export until converted — it is the only type information that code has.

## 4. Tenancy and Authorisation

- **CS-4.1** Never read `tenantId` from a request body, query or header. It comes from the principal. → [13](./13-SECURITY-CODING-RULES.md)
- **CS-4.2** Every route declares a permission gate. A route open to all authenticated users says so explicitly and is listed in the review.
- **CS-4.3** A model without a tenant attribute (`Tenant`) is not scoped by the hooks. Loading it from a request id needs an ownership check.
- **CS-4.4** Cross-tenant access returns **404**.
- **CS-4.5** Configuration that changes where tenant data goes — storage, webhooks, domains — is `denyApiKey` and gated to an admin role.

## 5. Data

- **CS-5.1** Mutations run in a transaction that also writes the audit row. → [07](./07-DATABASE-ACCESS-STANDARDS.md)
- **CS-5.2** Optional includes carry `required: false`.
- **CS-5.3** Raw SQL carries its tenant predicate, bound; `$n` placeholders use `bind`, never `replacements`.
- **CS-5.4** Never edit an applied migration; never change a recorded migration name.
- **CS-5.5** PostgreSQL features are allowed (ADR-039); a new extension or an RLS policy is an ADR.

## 6. Errors and Responses

- **CS-6.1** Only the central error handler writes an error response. → [06](./06-ERROR-RESPONSE-STANDARDS.md)
- **CS-6.2** Expected failures throw `AppError` with the correct status. Invalid state transitions are 409 with a state explanation.
- **CS-6.3** Never return a default from a `catch` unless the default is a true answer.
- **CS-6.4** Rows in `data`, pagination in top-level `meta`.

## 7. Async, Cache and Queue

- **CS-7.1** [TS] No floating promises. Fire-and-forget is `void`-prefixed with a comment saying why. → [08](./08-CACHE-QUEUE-STANDARDS.md)
- **CS-7.2** A Redis key that holds tenant data contains the tenant id.
- **CS-7.3** "Check then mark" is racy: claim with `SET NX`, and release the claim when the attempt fails.
- **CS-7.4** Anything that can outlive a request — email, webhooks, exports — goes through RabbitMQ, not an in-process timer.
- **CS-7.5** Readiness of the shared Redis client is `client.status === "ready"`. ioredis has no `connected` property.

## 8. Configuration

- **CS-8.1** [TS] `process.env` is read only in `src/config/`.
- **CS-8.2** A new variable is added to `.env.example` **and** `docs/BACKEND/11-CONFIGURATION.md` in the same commit.
- **CS-8.3** A missing required secret stops startup, naming every missing variable at once.

## 9. Logging

- **CS-9.1** Use the shared winston logger; no `console.*` in application code. → [12](./12-LOGGING-CONVENTIONS.md)
- **CS-9.2** Every request-scoped log line carries the request id.
- **CS-9.3** Never log a secret, a token, a password or a full request body.

## 10. Tests

- **CS-10.1** 100% coverage on the paths the gate measures; a file is not converted if it drops below. → [09](./09-TESTING-CONVENTIONS.md)
- **CS-10.2** Every new `:id` route has a two-tenant test asserting 404.
- **CS-10.3** A mock must look like the real dependency. A mock that fabricates a property the real library lacks is a defect in the test.
- **CS-10.4** A test must not assert an implementation detail it copied from the code (`replacements: [...]`). Assert behaviour.

## 11. Dependencies

- **CS-11.1** A new runtime dependency is an ADR-worthy choice; write it into `MEMORY/DECISIONS.md` first.
- **CS-11.2** A dependency nothing imports is removed (`aedes`, `aedes-server-factory` — A-18).

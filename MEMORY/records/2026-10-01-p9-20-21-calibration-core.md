# 2026-10-01 — P9-20/21: calibration core converted end to end (services, controllers, routes, `.openapi.ts`), plus quota, sop and workflow

**ADR:** ADR-087 (Amendment 13 pattern; Amendment 15 load gate) · ADR-103 (P9-25 code-first contract). The amendment text for the Phase 9 lead is at the end of this record.
**Cards:** P9-20 / P9-21 (the lead's lane assignment of 2026-09-30), P9-14 (the four calibration services still in `.js`), P9-25 (per-route contract migration).
**Agent:** Phase 9 services helper. No git writes were made.
**Handed over:** vendor, risk, supplierScorecard, finance, billing and meteredBilling (controllers + routes) went to the P9-22 helper at its request, before I had touched any of them.

## What changed

| Module | Now | Evidence |
|---|---|---|
| `services/calibrationDevices.service` | `.ts` | identity 2,681 checks / 0 different; 8/8 plants; 100%; live PG18 |
| `services/calibrationScheduler.service` | `.ts` | identity 300 checks × 5 env variants / 0 different; 6/6 plants; 100%; live PG18 |
| `services/certificate.service` | `.ts` | identity 3,631 / 0; 10/10 plants; 100%; live PG18 |
| `services/eSignature.service` | `.ts` | identity 5,190 / 0 (3 env variants + the V-17 load refusal); 12/12 plants; 100%; live PG18 |
| (re-proved) `calibrationRecords`, `calibrationDeviceReinstate`, `certificatePdf` services | already `.ts` (previous round) | re-run under the corrected harness: 879 / 849 / 208, 0 different; plants 5/5, 4/4, 5/5 |
| controllers `calibrationScheduler`, `calibrationRecords`, `calibrationDevices`, `calibrationDeviceReinstate`, `certificate`, `certificatePdf`, `eSignature`, `quota`, `sop`, `workflow` | `.ts` (`export =`) | controller harness 485 / 1,391 / 5,370 / 123 / 1,371 / 431 / 1,569 / 15 / 649 / 771 checks, 0 different; plants bitten for each |
| routes `calibrationScheduler`, `calibrationRecords`, `calibrationDevices`, `certificates`, `eSignature`, `quota`, `sop`, `workflows` | `.ts` + `<m>.openapi.ts`; JSDoc gone | mounted-route-table identity: 2 / 5 / 8 / 14 / 15 / 1 / 5 / 7 layers IDENTICAL |

**New `.d.ts` files**, for still-JavaScript dependencies. Each is held by declarationDrift.p912 (15/15 via `npm test`):
- `attachment.service.d.ts`;
- `maintenance.service.d.ts`. The P9-22 helper since typed more of it.
- `notification.service.d.ts`. Deleted again when the leaf helper converted notification.

**Typed members in existing `.d.ts` files:**
- `webhook#emitEvent`. That `.d.ts` is gone now that webhook converted.
- `mfa#verifyLogin`;
- `dynamicAccess#principalHasMenuPermission`.

**Shared builder** (`docs/openapi/operation.ts`). Both changes are additive:
- `bodyMediaType: "multipart/form-data"`, for the CSV import.
- `Permission.resource` may be a `string[]`, for `dynamicAccess([...], "write")` on the workflow decision. It publishes as the array the p925 guard reads off the chain.

**Lists kept honest** (shrink-only):
- **`docs/components.js`:** the JSDoc components `CalibrationRecord`, `CalibrationRecordCreateRequest`, `CalibrationDevice`, `CalibrationDeviceCreateRequest`, `Certificate` and `CertificateCreateRequest` were removed. Their only users were the deleted `.js` routes, and they collided with the code-first ids.
- **`openapiRoutes.undocumented.json`:** certificates `submit` and 11 esignature routes removed.
- **P6-08 `knownDrift`:** certificates `approve` and 4 esignature entries removed.
- **Spectral baseline:** 3 entries removed. They were the JSDoc for the wrong path `/api/v1/e-signature`, which went with the `.js`.
- **`routeGateExemptions.ts`:** keys re-pointed to `api/certificates.route.ts` and `api/sop.route.ts`.

**Tests re-keyed** (`.js` → `.ts` path or key only):
- d24 unboundedFindAll: devices 1, scheduler 2, certificate 1, eSignature 8.
- a127 denyPlatformAuthoring: records 3, certificates, eSignature 5, sop 2, workflows.
- a78 uploadAfterGate: 1.
- signatureEvidence.d18: 1 path.
- esignature.noRevocation.a107 and eSignature.gate.a84: the route path.
- authorizationWiring: the workflows file regex.
- `quota`, `sop` and `workflows` `.route.test.js`: the require path.

**Service types only** (`| undefined` under `exactOptionalPropertyTypes`; `userAgent: string | string[]` where `auditActor` passes the raw header). Behaviour is unchanged.

## How each module was proved

1. **Snapshot first.** I snapshotted the `.js` into `p9com/wc2` (services) or `p9com/wc3` (controllers, routes). `cert`/`eSignature` stability was checked: mtime and `cmp` unchanged since snapshot, re-checked immediately before each swap.
2. **Write and compile in the scratch mirror.** The `.ts` was written in `p9com/mirror/src`, compiled with TypeScript 7 (`tsconfig.build`), and linted (via `--stdin` while the file did not exist yet, in place after the swap).
3. **Services: identity harness against recorded fakes, bite-tested.**
   - The models barrel, `config`, the logger and the services a module calls are recording fakes.
   - Validators, constants and `crypto` are real.
   - The eSignature harness signs with a fixed real RSA key, with `generateKeyPair`/`randomBytes` pinned.
4. **Controllers: `ctl-lib.js` under tsx.**
   - Both controllers load with the same real dependencies, except the services, which are fakes.
   - Every handler runs over a request matrix and several service modes.
   - Compared: response status, headers, body, `download`/`sendFile`, `next(err)`, and every fake call.
5. **Routes: `rt.js` under tsx.**
   - Every middleware module's function exports are wrapped in `require.cache` before either router loads.
   - So a gate factory is labelled by its arguments, `validate(schema)` by the schema's validator export, and a handler by its controller export.
   - The two tables must be deep-equal.
   - Bite-tested: a changed gate argument, a dropped `auth` and a swapped handler each read DIFFERENT.
6. **Swap atomically.** `cmp` against the snapshot, `cp` the `.ts`, `rm` the `.js`, then `TSX_DISABLE_CACHE=1 npm run load:check -- --src`.
7. **Gates after each swap:**
   - lint;
   - typecheck;
   - `openapi:generate`, then `openapi:lint` (Spectral: no new error), then `openapi:check`;
   - the frontend `api:types`;
   - the module's suites plus all guards, P6-04, P6-08 and A-127, with 100% coverage on the converted files;
   - `build:dist` and `load:check` in both modes.

## The four gates for the calibration core

- **(a) Guards bite on the `.ts`.**
  - d12: `signedByUser` lost `required: false` in `certificate.service.ts`.
  - d24: an extra unbounded `TenantKey.findAll` in `eSignature.service.ts`.
  - p611 auditInTransaction: the device-create audit call was moved outside its transaction.
  - Each failed, naming the `.ts`. 48/48 on restore.
- **(b) Identity:** as in the table above.
- **(c) Suites:** as in the table above, every converted file at 100%.
- **(d) Live PostgreSQL 18.6, as `callibrator_app`, two tenants.** A fresh `pgvector/pgvector:pg18` container (`p920-pg18`) was migrated by booting the backend from source.
  - **Service level: `p9com/live-calib.js`, 53/53.**
    - All six services resolve to `.ts`, and `current_user` is `callibrator_app`.
    - Cross-tenant 404 on: device read and delete; record read and correct; certificate read and approve, with no re-authentication consumed; a forged tenant id; the due preview; the signature workflow read and sign.
    - ADR-101: the author approving is a 403 with the SoD message, and nothing is written. A-126: the failure row survives the rollback.
    - Approve and sign by another user.
    - Q-50: the snapshot is stored with a v3 hash, and both are unchanged after the issuer is renamed (an owner `psql`).
    - A-293: no token gives the minimal verdict, a wrong token answers exactly like none, the right one gives the full verdict.
    - Append-only: as the app role, an `UPDATE` or `DELETE` on `calibration_records` is refused. A correction is a new row, the original is superseded, and a void keeps the row.
    - E-signature: key, workflow, an RS256 v2 signature, verified valid.
  - **HTTP level: `p9com/live-http.js`, 44/44.**
    - The real app on port 5999 serves every converted route; the three users sign in through `/auth/login`.
    - The envelope: rows in `data`, `meta` top-level.
    - Devices: a duplicate serial is a 409 with the explanation; a malformed id is a 400.
    - Records: there is no update route; corrections and voids behave as above.
    - Certificates: the SoD 403; A-62 (`approvedBy` is the caller even when the body names another user); sign twice is a 409; delete signed is a 409; the document read; Q-50 and A-293 through the public `/verify`; `/stats` is not shadowed by `/:certificateId`.
    - E-signature: key, workflow, `/my-workflows`, the A-65 non-signer 403, B signing A's step is a 404, sign, verify, delete signed is a 409, history.
    - The scheduler preview is confined to the caller's tenant.
    - The first HTTP run's single failure was the fixture: the test role lacked `maintenance` read. It passed once granted.

## Defects of the harness, found and fixed (the evidence before them was NOT valid)

Recorded because each one made earlier evidence look stronger than it was.

1. **Every run exited 1, so every plant "bit".**
   - The raw `eq("module", A, B)` differed on function `.name`: an arrow assigned to `exports.x` is anonymous, a `.ts` const is named.
   - So every run exited 1, and every plant read BITTEN whether or not it was caught.
   - The P9-14 plant counts for devices, scheduler, certificate and eSignature (and the "names only" records count of the previous round) were therefore unproven.
   - Fixed: `namesonly.js` compares the module with function names stripped. Every baseline now exits 0, and every plant was re-run.
2. **The validators never loaded, so validated paths were never compared.**
   - Under plain `node`, the validators (re-exports of `@callibrator/contracts` `.ts` source) failed with `ERR_MODULE_NOT_FOUND`, identically in both modules.
   - Fixed: the harnesses run under `node --import tsx`.
   - This surfaced inputs that never reached the code: device names must be ≥ 2 characters.
3. **A late unlink callback leaked between runs.** It recorded into the next run, so the order looked flaky. Fixed: pending I/O is tracked and drained before a run ends.
4. **A scripted gate was set after the handler had read it.** Fixed: a mode's state is applied before the handler runs.

The surviving plants after fix 2 were all harness gaps, never conversion differences: no 400 mode, no observed logger, no padded `FRONTEND_URL`, a workflow that never completed. Each gap was closed and its plant then bit.

## Conversion findings that changed the code

- **Controllers are `export =`, not named exports.** tsc emits `exports.b = exports.a = void 0`, which reverses the export key order against the `.js`, and adds `__esModule`. The routes read `ctrl.x` off the module object, as the `.js` did, or destructure it at load where the `.js` did (eSignature, sop).
- **Destructuring `req.user` stays inline.** V8's destructuring TypeError quotes the source text (`Cannot destructure property 'tenantId' of 'req.user'…`), and that message reaches a 500's body. A helper changed it. Property reads are safe: their message quotes no source.
- **`certificateDocument.service` has named exports, so it is imported with `import * as`.** A default import is `undefined` at run time; tsc accepts it under `esModuleInterop`, and only the harness caught it.
- **`eSignature.service` still requires `signingKeyWrap` after the V-17 `SIGNATURE_ALGORITHM` check,** as the `.js` did. With `SIGNATURE_ALGORITHM=RS512`, both modules throw the same error and neither has loaded `signingKeyWrap`.
- **`SIGNATURE_TTL_MS`** was read into a constant nothing used; the effect-free read was dropped (stated in the file header). **`process.env`** reads go through `config/env` (`CORS_ORIGIN`, `FRONTEND_URL`/`HOST_URL` at call time; the scheduler's three settings and eSignature's at load).
- **x-permission of restore/reinstate** is `rbac TENANT_ADMIN`, the chain's first gate (p925); the `calibration` write gate is named in the description.

## Incidents

- **A planted guard defect surfaced as a red typecheck to the coordinator.** For gate (a), I planted in the shared tree. The p611 plant left `actor` unused in `calibrationDevices.service.ts` for about a minute, and the coordinator saw `npm run typecheck` red.
  - It was restored byte-for-byte from backup. Nothing was removed for real.
  - From then on, plants went only into the scratch mirror.
- **Other lanes' in-flight swaps reddened shared gates while I worked.** None were my files:
  - `TenantBackup` defined twice;
  - an `auth` `User` ref;
  - `dashboard.service.ts`, `storage/index.ts` and `webhook.service.ts` type errors;
  - `.js`/`.ts` pairs of `webhookDeliveryPurgeScheduler` and `abac`.
  - Each was reported as theirs and re-run once it cleared. At the time of writing, typecheck and build:dist were red only on `webhook.service.ts` and `abac.middleware`, both another lane's.

## Not done

- **Defects:** no behaviour defect was found in the modules converted this round, so no AUDIT row was opened.
- **Cleanup:** the scratch container `p920-pg18` and the junctions are removed with this record.

## ADR-087 amendment text (for the Phase 9 lead to merge)

> **Amendment (P9-20/21, 2026-10-01) — controllers, routes and the evidence that proves them.**
> 1. A converted controller is `export =` of one object in the `.js`'s key order (named exports reorder keys via tsc's `exports.b = exports.a = void 0` and add `__esModule`). A route reads the handlers off that object, or destructures it at load where the `.js` did.
> 2. A handler destructures `req.user` inline where the `.js` did: V8's destructuring TypeError quotes the source expression, and that message reaches a 500 body.
> 3. A module with named exports (`certificateDocument.service`) is imported with `import * as`; a default import compiles under `esModuleInterop` and is `undefined` at run time.
> 4. Evidence for a controller/route conversion: (a) a mounted-route-table identity that labels gate factories by their arguments and handlers by their export, bite-tested; (b) a controller identity over a request matrix and service modes, under `node --import tsx` (validators re-export `@callibrator/contracts` `.ts` source, which plain node cannot load — a harness run under plain node compares error paths only); (c) the module's own suites, the route guards (P6-04, P6-08, A-127, P9-25) and the contract gates (`openapi:generate`/`lint`/`check`, frontend `api:types`).
> 5. An identity harness must exit 0 on its unplanted baseline before any plant is counted. A `.name`-only difference is reported by a names-stripped comparison, never left in the raw module equality.
> 6. Plants go into the scratch copy, never the shared tree: a planted defect in the tree is a red gate for every other lane.

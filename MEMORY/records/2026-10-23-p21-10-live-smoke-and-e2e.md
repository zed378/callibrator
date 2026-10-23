# P21-10: live API smoke of every route and live E2E of the Phase 21–24 flows

**Date:** 2026-10-23 · **Card:** P21-10 · **Status:** DONE. **No backend defect was found.** One defect in the smoke itself was found and fixed.

## The stack

- **Build:** a disposable compose stack, project `s1p2110`, `BUILD_TAG=s1p2110`, from `docker-compose.yml` + `docker-compose.build.yml` + `docker-compose.e2e.yml`. It was built from the working tree (P24-03 included) and ran on ports 27330–27332.
- **Mode:** `E2E_NODE_ENV=development`, because the contract smoke needs the demo seed, which production refuses.
- **Env file:** made by `scripts/ci/e2e-env.sh`, plus `SEED_DEMO=true`.
- **Seeding:** `/migration/seeding` then `/migration/seed-demo`, both 200.
- **Fresh state:** the stack was taken down with `down -v` and brought up again on fresh volumes for the final runs.

## The runs (final, on the fresh volumes)

1. **`e2e/modules/p21-upstream-flows.e2e.test.ts` (new): 15/15, run twice back to back.** It covers:
   - **Facility scope:** the self facility; a client facility added; `/mine` and `/options`. Another tenant's facility, and its users list, answer 404.
   - **Catalogue:** device type → item definition → template → draft → items → publish, by the operator. The tenant reads the published catalogue; a tenant writing it gets 403.
   - **Register:** a device in the client facility with a new room. `GET /warehouses?kind=room&clientFacilityId=` lists that facility's rooms only. Another tenant's device, QR lookup and facility filter answer 404 / nothing.
   - **IPM session:**
     - an incomplete submit answers 400, naming the items;
     - every item of the published version is answered by its input kind, then the header is set and the session submitted, which gives a report number;
     - `report-document` holds the number and the verification link;
     - `unsigned=true` lists the session until the performer signs; a wrong password is refused; `unsigned=false` lists it after;
     - `/ipm/verify/:n?token=` answers 200. A wrong number and a wrong token give the same 404 and message;
     - tenant B gets 404 on read, report, void and signature, and its list holds nothing.
   - **Public device page:** a token is issued, 22 characters. While the tenant's setting is off, the token gets 404. With `minimal`, it answers the name, type and facility, and never the serial, the QR or the room. Revoke: tenant B 404; a revoked token and an unknown one give the same answer.
   - **Imports:**
     - the settings say `transformAvailable: true` and `realDataAllowed: false`; the image-import config is readable; a tenant gets 403;
     - a synthetic dump (`support/syntheticUpstreamDump`) is uploaded as multipart, loaded, and **transformed into the provider tenant through the API: 13 steps**.
   - **Invitations:** an imported account awaits its invitation. The issue answers 409 while the operator's switch is closed, and tenant A gets 404. The operator opens the switch through `PATCH /admin/tenants/:id/flags`. The invitation is mailed (Mailpit), accepted once (a second accept is refused), and the user signs in.
2. **The live contract smoke (`npm run test:contract`): 5/5.**
   - **561 routes:** 5xx/timeouts 0, envelope 0, cross-tenant 2xx 0, frontend missing 0, frontend shape 0.
   - **Statuses:** 200 × 280, 201 × 39, 204 × 2, 302 × 6, 400 × 95, 401 × 16, 403 × 5, 404 × 90, 409 × 28.
   - **82 calls on Phase 21–24 routes.**
   - **The 15 cross-tenant 403s** are role gates that answer before any id is read (operator-only routes such as `ipm/item-definitions`, roles, sessions, SCIM, signed links). None is a tenant answer.

## Defect found and fixed

- **The smoke reported the global catalogue as a cross-tenant leak:** `GET /device-types/:id` answered 200 to tenant B. Device types, item definitions and templates are the platform's (ADR-125), read by every tenant.
  - **Fix:** `liveContract.smoke.test.js` now reads the route docs that declare `tenantScoped: false` (ADR-103) and reports their GETs as `global`, as it already did for `public`. A new global module needs no edit.

## Observed, not changed (outside the card's routes)

- **`GET /admin/tenants`** (before Phase 21) answers `data: { tenants, total, page, … }`, not rows in `data` with a top-level `meta`. The smoke does not flag it, because the frontend reads `data.tenants`. It is left as built and noted here for the envelope sweep.
- **Error bodies on this development-mode stack** carry `details` / `stack`. That is non-production behaviour, and production mode was not run here.
- **Running order:** the contract smoke is destructive (it deletes `demo-beta`) and refuses a re-run on the same stack. Run the flows spec before it, at least 30 s apart, because the operator's TOTP code is single-use.

## Gates

- eslint on `p21-upstream-flows.e2e.test.ts` and `liveContract.smoke.test.js`: clean. The ratchet is unchanged (no new `.js` file).
- The new spec is TypeScript and reads only its env (`E2E_P21_PROVIDER_CODE` optionally names the provider tenant; default `P21E2EUPSTREAMPROVIDER`, the same on every run, because the id map binds one upstream system to one provider).

## Files

- `backend/src/tests/e2e/modules/p21-upstream-flows.e2e.test.ts` (new), `backend/src/tests/e2e/liveContract.smoke.test.js`
- `TASKS/PHASE-21-UPSTREAM-BACKEND.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record

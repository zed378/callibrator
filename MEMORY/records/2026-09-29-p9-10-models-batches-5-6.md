# 2026-09-29 — P9-10 batches 5–6: calibration, certificates and signature models are TypeScript

**ADR:** [ADR-087 Amendment 9](../DECISIONS.md) · **Card:** P9-10 (**46 of 71** models) · **Tree:** HEAD `35ebd76` plus the working tree. I was the only agent editing. Continues [`2026-09-29-p9-10-models-batches-3-4.md`](./2026-09-29-p9-10-models-batches-3-4.md).

## What changed

| Area | Files |
|---|---|
| Batch 5, calibration and certificates (6) | `src/models/calibrationDevice`, `calibrationRecord`, `certificate`, `iotReading`, `attachment`, `documentChunk` (`.model.ts`, `.js` removed) |
| Batch 6, signatures (4) | `src/models/eSignatureRecord`, `signatureRecord`, `signatureWorkflow`, `signatureWorkflowStep` (`.model.ts`, `.js` removed) |
| New shared types | `src/types/json.ts` (`JsonValue`, `JsonObject`); `src/types/sequelize.d.ts` (`skipTenantScope` on `FindOptions`) |
| D-27 types, beside the Joi shapes (`src/utils/jsonShape.util.ts`) | `UncertaintyBudget`, `IotMetrics`, `CalibrationResults`, `MetricBounds` / `ReadingTolerance`, `SignaturePolygon`, `SignatureBiometricData` |
| `src/types/models.ts` | 10 more entries |
| Ratchet | `backend/.ts-ratchet.json` floor 1129 → **1119** |
| Docs | ADR-087 Amendment 9; the P9-10 card; `TASKS/PROGRESS.md`; `docs/ENGINEERING/04` banner (97 modules); the `CLAUDE.md` scale row |

## Evidence

**Checks at each batch boundary**

| Check | Batch 5 | Batch 6 |
|---|---|---|
| TypeScript 7 `--noEmit` | clean | clean |
| Full-barrel definition equality (`p9/compareModels.js`), now with validators and instance methods | 71 identical | 71 identical |
| Model guards, migrations, d05, d27, domain suites | 137 suites / 3,417 tests | 87 suites / 2,291 tests; `signatureEvidence.d18` + `eSignature.twoTenant` 7/7 |
| Models' own figure | 95.93 / 75.32 / 95.14 / 95.87 | **95.99 / 75.32 / 95.14 / 95.93** |
| Full gate `npm run test:coverage -- --ci --forceExit` | 700 suites / 13,065 tests / 100% | **700 suites / 13,065 tests / 100%** |
| Live on PostgreSQL 18.6 as `callibrator_app`: `dbD` / `dbC` / `w33` / `dbB` / **`p6`** / **`q02`** | 6/6 · 4/4 · 12/12 · 10/10 · 22/22 · 10/10 | 6/6 · 4/4 · 12/12 · 10/10 · 22/22 · 10/10 |
| Live probe | `p9/live-b5.js` **41/41** | `p9/live-b6.js` **18/18** |

- Attachment and Certificate were below 100% as JavaScript (ADR-092's list) and did not fall: 84.61 → 86.66 and 88.13 → 88.52.
- The batch 5 probe covers A-29, A-133, Q-02, P6-03, the Certificate transitions and numbering, D-22, D-27 and isolation.
- The batch 6 probe covers D-27, D-18 RESTRICT, the A-149 revoker FK, joins and isolation.

**The harness bites.** Each of these plants fails it:
- `toJSON` keeping `iotTokenHash`;
- `submitForApproval` landing on the wrong status;
- `sign`'s `||` changed to `??`;
- `revoke` no longer idempotent;
- the D-22 validator accepting everything;
- a D-27 shape key swapped.

**Other boundary checks**
- ESLint ratchet: 0 errors.
- `includeRequired.d12`: 24/24, with five branded models.
- `build:dist`: 101 TypeScript files compiled.
- The container and exactly its volume were removed.

## Found, not changed

`keyRotation.s08.live` fails 2 of 5 on a fresh database. Since S-20 (migration 0086, `a31c601`), `keyRotation.service` also walks `users.mfa_secret` and `mfa_pending_secret`. The test's expected report, last touched in `8a11905`, lists no `users` rows. No converted model is involved; this is for the owner.

## Open

- **25 models remain.** In the owner's order:
  1. content, tickets and GDPR;
  2. platform;
  3. LAST, the tenant-isolation-critical batch, in the same merge as the barrel. It needs the isolation suites, the `twoTenantRoutes` guard, a live two-tenant probe, and a Docker build and boot plus the P9-00 E2E baseline.
- **Nothing is committed** by me.

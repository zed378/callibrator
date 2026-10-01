# 2026-09-30 — ADR-095 follow-ups: the boot self-check covers audit_logs, live suites use a disposable database, memory limits re-sized, a Unicode font in the certificate PDF, the browser smoke live

**ADR:** [ADR-095 Amendment 1](../DECISIONS.md) · **Closes:** ADR-095 open items O-1, O-2, O-4, O-5 and O-6 (O-3 and O-7
belong to other lanes) · **Record of the original change:**
[`2026-09-29-adr095-audit-append-only-pdf-frontend.md`](2026-09-29-adr095-audit-append-only-pdf-frontend.md)
· **Tree:** HEAD `ce74932` plus the uncommitted Phase 9/10 work. At least six other lanes were editing the
tree while this ran (Phase 9 conversions, Phase 10 restyle, A-303/Q-50 certificate snapshot, Q-51, F-19,
ADR-106). Nothing was committed, staged or stashed.

## What changed

| Item | Files |
|---|---|
| O-1 boot self-check | `backend/src/utils/dbRole.util.ts`: `enterApplicationRole` now also reads `has_table_privilege('audit_logs', DELETE / TRUNCATE / INSERT)` and the audit_logs columns the role may UPDATE (`pg_attribute` × `has_column_privilege`). It refuses the boot unless DELETE and TRUNCATE are absent, INSERT is present and the updatable columns are **exactly** `changes, ip_address, user_agent` (`AUDIT_MASKABLE_COLUMNS`, exported). A missing masking grant is refused too: it would break GDPR masking (A-135). Still one query, through `sql()` |
| O-1 tests | `src/tests/utils/dbRole.util.p603.test.js` (+7 cases); `src/tests/services/dataIntegrity.p6.live.test.js` applies 0091 in its setup and gains four live refusals (DELETE, TRUNCATE, `UPDATE (action)`, a revoked masking column), and longer hook timeouts for a loaded host |
| O-2 live suites | **new** `src/tests/fixtures/disposableDatabase.ts` (`CREATE DATABASE <prefix>_<hex>_scratch`, optional `LIVE_DB_TEMPLATE`, `DROP … WITH (FORCE)`, `LIVE_BOOT_TIMEOUT_MS`) and **new** `src/tests/fixtures/liveBoot.ts` (`bootSchema` = `runSchemaSetup`, `enterAppRole` = `enterApplicationRole`). **Eight** suites no longer delete audit rows: the three ADR-095 named (`batchJob.w07`, `calibrationScheduler.w03`, `tenantHardDelete.w20`) and five more found by grep (`backgroundJobs.w12`, `bulkDestroyRoutes.w33`, `calibrationScheduler.batch.w17`, `iot.sharedSubscription.w14`, `retentionExports.w15w16`). Each builds its own database as the backend boots (sync + every migration, 0091 included), runs as `callibrator_app`, and drops the database. No trigger is disabled anywhere. `w07` and `w20` gained an assertion that they run as `callibrator_app` on a database where an audit DELETE is refused |
| O-4 memory | `deploy/compose/docker-compose.{prod,staging,vm}.yml`, `deploy/helm/callibrator/values.yaml`, `values-prod.yaml`, `values-staging.yaml`, `charts/backend/values.yaml`. `docs/DEVOPS/09-KUBERNETES.md` § Resources amended |
| O-5 Unicode PDF | `frontend/src/lib/certificatePdf.ts`: `loadCertificateFont` (fetched once, only when a PDF is rendered; a failed fetch is not cached), `pdfUnicodeText`, `codeMapOf`, `CERTIFICATE_FONT_*`; Helvetica + Latin-1 folding stays as the fallback. **New** `frontend/public/fonts/NotoSans-{Regular,Bold}-LGC.ttf` (135 KB each), `frontend/public/licenses/OFL-NotoSans.txt`, a row in `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` §12. **New** test `frontend/src/lib/certificatePdf.unicode.test.ts` |
| O-6 smoke | `automate/smoke.browser.js`: `assertCertificatePdf` reads the printed text through the PDF's ToUnicode CMaps (`printedTexts`) and requires the embedded font; the verification check follows the certificate's own `verifyUrl` token (A-293) and reads the English copy of the restyled page (`locale=en` cookie, `verify.validLead`) |

## The font

Noto Sans 2.015 (SIL OFL 1.1, no Reserved Font Name), unhinted TTF from `notofonts/notofonts.github.io`,
subset with fontTools 4.65 (`--no-hinting --layout-features=''`) to: Basic Latin, Latin-1, Latin
Extended-A/-B, IPA, spacing modifiers, combining marks, Greek, Cyrillic (+ supplement), Latin Extended
Additional (Vietnamese), general punctuation, super/subscripts, currency, letterlike symbols, number forms,
arrows, mathematical operators, ◊ and the Latin ligatures — 1,789 code points. jsPDF subsets again when it
embeds, so a PDF grows by ~40 KB (the dashboard PDF was 182,620 bytes before, 233,711 now).

**Covered:** Vietnamese ("Bệnh viện Đà Nẵng", "Đặng Văn Hùng"), Polish ("Łukasz Wróblewski"), German,
French, Turkish ("Şükrü Öztürk"), Nordic, Greek, Cyrillic, `°`, `µ`, `±`, `–`, curly quotes.
**Not covered, printed as `?` one per character:** Arabic, Hebrew, CJK, Thai, Indic scripts, emoji. A
character outside the font whose compatibility decomposition is covered prints as that ("ＡＢ" → "AB").
Before, "Đ" and "Ł" printed as "?" as well, since they have no decomposition. The hash is unchanged:
it is computed by the backend over data, never over the PDF bytes, and the PDF prints it verbatim (in
Courier, a standard font).

## Evidence

### O-1 — the boot self-check

- `npx jest src/tests/utils/dbRole.util.p603 --coverage` — **27/27**, `dbRole.util.ts` 100/100/100/100.
- Live, `pgvector/pgvector:pg18` (PostgreSQL 18.6), `DATA_PG_LIVE_TEST=1 … dataIntegrity.p6.live`, run 3
  (`p6d`): the whole P6-03 block passes, including **"enterApplicationRole REFUSES a role with DELETE /
  TRUNCATE / UPDATE of action / no masking grant on audit_logs"** (4/4) and the existing calibration-records
  refusal. An earlier run of the suite before the four new cases passed **22/22**. The suite's last run is
  22/26: all four failures (three P6-05 checks and "migration 0057 › down … up restores it") are
  `verifySchema` naming **Q-51's migration 0105** (`…_actor_exactly_one`), which this suite's hand-picked
  migration list does not apply. **Fixed afterwards (below): 26/26.**
- **The image booted with it:** `[schema-verify] OK: 74 tables, 919 columns and 13 control objects`, then
  `Database queries now run as the application role "callibrator_app" (… audit_logs append-only but for
  masking)`.

### O-2 — the live suites, as `callibrator_app` on PostgreSQL 18.6

`LIVE_DB_TEMPLATE=live_tpl` (a database booted once by the same `runSchemaSetup`: 74 migrations, 613 s on
this host) and `--runInBand`, from a scratch snapshot of the tree (the live tree was mid-rename:
`0086-….js` → `.ts` broke jest's module map during the first attempt):

| Suite | Result |
|---|---|
| `tenantHardDelete.w20.live` | **PASS** (4/4, incl. the new "cannot delete or truncate an audit row") |
| `batchJob.w07.live` | **PASS** (incl. the new "runs as the application role") |
| `calibrationScheduler.w03.live` | **PASS** |
| `backgroundJobs.w12.live` | **PASS** |
| `calibrationScheduler.batch.w17.live` | **PASS** |
| `retentionExports.w15w16.live` | **PASS** |
| `bulkDestroyRoutes.w33.live` | 1 failed then: `oidc.deleteClient(A, "w33")` → "An audit entry must name its actor". **Fixed afterwards (below): 12/12** |

**Total: 7 suites, 34 passed, 1 failed, 35 tests, 1,167 s.** Every scratch database the passing run
created was dropped (none left afterwards). Five left by an earlier run that was **killed mid-way** had to be
dropped by hand: a crashed run leaves its database behind, by design (`DROP` runs in `afterAll`).
`iot.sharedSubscription.w14.live` needs an MQTT broker and was **not run**; it is only syntax- and
lint-checked.

### O-4 — measured memory, and the new limits

The backend image built from the tree (see *Images* below), unconstrained, sampled every ~10 s by
`docker stats` and read at the end from the container's cgroup:

| Load | |
|---|---|
| boot: sync + 74 migrations + schema-verify | peak sample 297.5 MiB |
| `GET /migration/seeding` | — |
| three live E2E runs (two of them concurrent), 401 tests each | — |
| six browser-smoke runs | — |
| **cgroup `memory.peak`** (whole life) | **321,077,248 B = 306 MiB** |
| **Node `VmHWM`** (peak RSS) | **344,688 kB = 337 MiB** |
| steady, idle after the load | 215–265 MiB (`anon` 206 MiB) |

| Where | Limit before → after | Request/reservation before → after |
|---|---|---|
| Helm default (umbrella + subchart) | 4Gi → **1Gi** | 512Mi → **384Mi** |
| Helm staging | 2Gi → **1Gi** | 512Mi → **384Mi** |
| Helm prod | 4Gi → **1536Mi** | 1Gi → **512Mi** |
| compose prod | 4G → **1536M** | 1G → **512M** |
| compose staging | 2G → **1G** | 512M → **384M** |
| compose vm | 4G → **1G** | — |

Headroom: 3× the measured peak (4.5× in production). **This is E2E load, not production traffic**; a large
tenant's GDPR export or report is the likeliest thing to need more, and each comment says so.

`helm template` with CI's argument arrays: default values under `callibrator` and `prod` → **14 kinds** each;
`values-staging.yaml` → **11**; `values-prod.yaml` → **12**; `helm lint` passes on all four. The backend
Deployment renders `memory: 1Gi / 384Mi` (default and staging) and `1536Mi / 512Mi` (prod). kubeconform is
not installed on this workstation, so the schema step was **not** run. **The charts render; they are not
known to deploy.**

### O-5 — the Unicode PDF

- `npx jest src/lib/certificatePdf` (frontend) — **3 suites, 24/24** at the time of the change; **30/30**
  after the A-303 agent added its issuer block. `certificatePdf.ts` 100% statements/lines/functions, 96.15%
  branches (the unreached ones: a font whose cmap jsPDF did not parse, and `codePointAt` returning undefined).
- `certificatePdf.unicode.test.ts` renders a real PDF with the real font files and reads the text back
  through the PDF's own ToUnicode CMaps. It asserts "Bệnh viện Đà Nẵng", "Máy thở", "SN-Ø-17", "Dräger",
  "Đặng Văn Hùng", "Łukasz Wróblewski", "Zoë Brontë", "Αλέξανδρος · Анна Петрова · Şükrü Öztürk"; CJK
  "温度計 23 °C" → "??? 23 °C"; Arabic + fullwidth "مرحبا ＡＢ" → "????? AB"; the hash as a literal `(…) Tj`;
  one fetch of the two weights for several PDFs; and the fallback: a 404 font still renders, in Helvetica,
  with "?ang Van Hung" and "?ukasz Wroblewski" (what every certificate printed before), then retries.
- **Checked independently** with poppler `pdftotext -enc UTF-8` on a PDF rendered by the same code: "Bệnh
  viện Đà Nẵng", "Łukasz Zoë ?? ?????".
- `npm run typecheck` (frontend): exit 0. `npx eslint` on both files: clean.
- In the browser (below): the font is served signed-out (`GET /fonts/NotoSans-Regular-LGC.ttf` → 200,
  134,952 bytes), fetched under the enforced nonce CSP with **0 violations**, and embedded (`/FontFile2`).

### O-6 — `automate/smoke.browser.js`, live

Against the disposable stack below, `FRONTEND_URL=http://127.0.0.1:25601 BASE_URL=http://127.0.0.1:25600
node automate/smoke.browser.js`, run 6 at 13:36 UTC: **7/7 checks passed in 168 s, 0 CSP violations, 0 page
errors.**
- **ADR-101 works:** the seeded operator drafts, submits and signs; the HEALTHCARE ADMIN created for the run
  approves. The certificate reached `signed` (runs 3 to 6).
- The dashboard PDF and the public verification-page PDF: each `CERT-20260930-DEFAULT-0006.pdf`, 233,711
  bytes, QR + number + integrity hash (`certificate-content-v3` by then, Q-50), Unicode font embedded.

It took five runs to get there, and each failure was real:
1. The approver's first sign-in answered **403 `NETWORK_POLICY`**, then **403 `LOCATION_REQUIRED`**: an E2E
   network-security spec had left an `ip_allowlist` and a `geofence` on the default tenant when its own
   restore step timed out (the host was overloaded). Both rows were deleted from the disposable database.
2. "certificate number not printed": the smoke searched the bytes for `(CERT-…)`, which an embedded font
   never writes. Fixed with `printedTexts`.
3. "the verification endpoint does not report a valid, published certificate": since A-293 the public
   endpoint answers `disclosure: "minimal"` without the certificate's token. Fixed by following `verifyUrl`.
4. A 30 s wait for "Certificate is valid": the page was restyled (P10) and defaults to Indonesian. Fixed with
   the `locale=en` cookie and the `verify.validLead` copy.

### Images and the stack

- **The live tree did not build**, three times, each for another lane's in-flight work: `openapi:check`
  (routes' JSDoc changed without regenerating), `build:dist` (a `.js`/`.ts` pair for `finance.service`), and
  `tsc -p tsconfig.build.json` (`certificateDocument.service.ts#captureSignedSnapshot`,
  `exactOptionalPropertyTypes`; its owner was told and fixed it in the tree). **The images were built from a
  scratch snapshot** (robocopy of the tree at ≈18:40 local) with three snapshot-only changes:
  `openapi.json` regenerated, `finance.service.js` removed (the tree had only the `.ts` by then), and
  `transaction ?? null` in `captureSignedSnapshot`. Backend image 1.18 GB on disk as Docker reports it;
  frontend 341 MB.
- Stack: `docker compose -p adr095f` over a copy of `deploy/compose/docker-compose.yml` plus an override —
  named volumes only, no clamav or nginx, loopback ports 25600/25601, `NODE_ENV=production`,
  `DB_APP_ROLE=callibrator_app`, no memory limit. PostgreSQL 18.6, Redis 8.6, RabbitMQ 3.13.
- **The E2E runs are load, not a verdict.** On this host (a kind cluster and several other agents' stacks
  running), the clean run was 40/53 suites, 308/401 tests, with **134 client-side `TimeoutError`s**. The two
  earlier runs overlapped by mistake. No E2E pass or fail is claimed here.
- **Cleanup:** `compose down -v`, then `docker rm -f` / `volume rm` / `rmi` for the stack, the PG 18 test
  container (`adr095f-pg18`), its volume and both `:adr095f` images. At handback every container was stopped
  (`Exited`/`Dead`) and Docker Desktop, loaded by other lanes' clusters, was still removing them. If any
  `adr095f*` container, volume or image is still listed, it is this run's and safe to delete. The VM was not
  touched.

### Follow-up, same day: the two remaining live failures

- **`dataIntegrity.p6.live`** no longer depends on a hand-picked list for anything newer than
  `LAST_HAND_PICKED` (0091). The suite still applies 0026/0057/0059/0063/0089/0091 by hand, because several
  run over deliberately legacy rows. It then records those as executed and runs `migrator.up()`: every later
  migration comes from the manifest, as the boot applies it. The schema test asserts nothing is left pending.
  On a named disposable PG 18.6 (`adr095g-pg18`), the run applied 0093–0106 (14 migrations) and passed
  **26/26**.
- **`bulkDestroyRoutes.w33.live`**: the `oidc.deleteClient` call already carried `{ userId: USER_A }` in the
  tree (another lane). A second actor-less call, `storageSettings.clearSettings(A)`, then failed the same
  way; it now passes the controller's `auditPrincipal` shape. **12/12** on its own disposable database,
  which was dropped afterwards (0 `*_scratch` left). The container was removed by name.

## Left open

- `iot.sharedSubscription.w14.live` was not run (needs a broker).
- The E2E network-security spec leaves an allowlist and a geofence behind when its restore times out. A
  spec that changes tenant-wide sign-in policy should restore it in `afterAll`, whatever happens.
- The memory figures come from E2E load. Re-measure under a real tenant's exports before tightening.
- Arabic, Hebrew, CJK, Thai and Indic names still print as `?`. Covering them needs per-script fonts (CJK
  alone is megabytes) and, for Arabic, shaping. Worth doing only when a tenant needs it.

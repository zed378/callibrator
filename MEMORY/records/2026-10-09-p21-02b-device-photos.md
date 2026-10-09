# P21-02b: the device photos — upload and replace, delete, the derivative pipeline, signed links per variant

**Date:** 2026-10-09 · **Task:** P21-02b (Phase 21; the photo half of P21-02, ADR-132 Am. 2 § 1) · **Decision:** ADR-132 Amendment 3 (incl. the image-library decision) · **Specs:** [`P19-03`](../specs/P19-03-device-extensions.md) § 7.2, § 11, § 13 (as-built note added); `docs/UPSTREAM/08-FILE-POLICY.md` § 2 – § 5, § 7, § 11 · **Base commit:** `9b80154` · **Built with:** P21-06 (same tree, [record](./2026-10-09-p21-06-export-reads.md))

> **Privacy:** synthetic images only (gradients encoded in the tests; an EXIF block with a made-up GPS byte run). `mozivid/` was not touched. `FACILITY_BINDING_ENABLED` stays OFF.

## The dependency decision (ADR-132 Am. 3)

- **HEIC is not decoded by the server.** 415 `PHOTO_HEIC_UNSUPPORTED`; the PWA converts through a canvas, the mobile camera already writes JPEG. The prebuilt `sharp` was rejected: its libvips reads HEIF/AVIF but not HEVC-coded HEIC (patents), its addon's `$ORIGIN` RPATH to `libvips-cpp.so` breaks under pkg's addon extraction, and the musl builder would install the wrong libc's binaries for the glibc runtime. A WASM HEVC decoder was rejected (patent exposure, size, seconds per photo).
- **Derivatives in pure JavaScript:** `jpeg-js` 0.4.4 + `pngjs` 7.0.0 (+ dev `@types/pngjs` 6.0.5), exact versions. Measured: 1.98 – 2.02 s per synthetic 12-megapixel (7 MB) JPEG, three runs (event loop held — the recorded "bad").
- **Proven in the image:** `docker build -f backend/Dockerfile -t callibrator-backend:p2102b-proof .` from this tree (exit 0; pkg emitted no warning for either module). The binary booted against a throwaway PostgreSQL 18 (`[schema-verify] OK: 88 tables, 1274 columns and 124 control objects`, "Server running on port 3000"; its route graph — `calibrationDevices.route` → `devicePhoto.service` → `imageDerivatives` → `jpeg-js`, `pngjs`, all static imports — loaded at boot), and inside the container `POST /api/v1/calibration-devices/<uuid>/photos` answered **401** (mounted, behind `auth`) where an unknown sub-path answered 404. Container and image removed by name (`p2102b-proof-boot`, `callibrator-backend:p2102b-proof`); no prune. The decode itself inside the pkg binary was **not** exercised (that needs a signed-in request); it is exercised under node by the suites below.
- **Audit:** `node scripts/ci/npm-audit-gate.js` — "1 high/critical advisory(ies), 0 failing, production tree 0" (the one is the allowed dev-only `braces`).

## Built

| Area | What |
|---|---|
| Contracts | `deviceValues`: `DEVICE_PHOTO_PURPOSES`, `DEVICE_PHOTO_TYPES` (JPEG, PNG), `DEVICE_PHOTO_MAX_BYTES` (10 MB), `DEVICE_PHOTO_DISPLAY_PX` / `_THUMB_PX`, `ATTACHMENT_VARIANTS`, `DEVICE_PHOTO_CODES` (6). `calibrationDevices`: `devicePhotoUpload` (strict; `ipm_evidence` refused), `devicePhotoParams` |
| Routes | `POST /calibration-devices/:id/photos` (auth, `calibration` write, `denyPlatformAuthoring`, quota, multer held in quarantine, `releaseHeldUpload`, `validate(…, { from: ["params", "body"] })`, `Idempotency-Key`); `DELETE /calibration-devices/:id/photos/:attachmentId`. Both N-6 in `FACILITY_ACCESSIBLE_ROUTES` |
| Services | `devicePhoto.service` (device in context first; magic bytes; structure + limits + lossless GPS strip via `upstreamFileImport/imageInspect`; ClamAV fail-closed; strict decode; three objects under the device's facility; one transaction under the device lock: replace, insert, audits, idempotency; objects removed on any failure); `devicePhoto/imageDerivatives` (decode, orientation, area downscale, JFIF-only encode); `devicePhoto/derivativeKeys` |
| Attachments | `signed-url` takes `variant` (signed as `<id>~<variant>`, `&variant=` in the URL; 404 for a file without derivatives; 400 for an unknown variant at the service); the signed download opens the derivative; the generic delete, `attachmentFileSweep` and `attachmentRekey` carry the derivatives |
| Middleware | `releaseHeldUpload` — the quarantine copy removed on `finish`/`close` |
| OpenAPI | the two operations, `DevicePhoto`, 415/422 error components; `schema.d.ts` regenerated |

## What surprised me

1. **`twoTenantSuite` / `twoFacilitySuite` could not send a file**: both gained an optional `file` (a fresh `req.file` per request).
2. **The delete's two 404s differed in their dev-mode `details`** (two throw sites, two stacks): the suite's "identical body" check caught it; one throw site now.
3. **`mdb.rows()` returns copies**: the re-key case re-seeds the row instead of mutating it.

## Evidence — tests named

- **Contracts:** `test/devicePhotos.p2102b.test.ts` (5).
- **Unit:** `services/devicePhoto.derivatives.p2102b.test.ts` (17: no APP1/EXIF/GPS bytes in either derivative, sizes, orientation 6 portrait, PNG text + alpha flattened, no upscale, strict decode refuses a corrupt scan and a non-PNG, all 8 orientations + out-of-range, the orientation reader's edges, the keys); `middlewares/releaseHeldUpload.p2102b.test.ts` (2).
- **memoryDb (real chains, models, hooks, fake storage):** `routes/devicePhotos.p2102b.test.ts` (25: 201 with the original's GPS gone and three keys under F1; PNG; the replace with four audit rows; bound F1 upload; the idempotent replay; HEIC 415, GIF 415, under 1 KB / no frame / over the pixel limit / corrupt pixels 422, a virus 422, no file 400, `ipm_evidence` 400 — nothing stored for any; a non-decode failure 500 with nothing stored; a failed put and a failed transaction leave no object; a device gone mid-upload 404; the replay reader's 404; the delete and its identical 404s; the signed link per variant (403 for every other variant); variant 404/400; the generic delete, the sweep and the re-key carry the derivatives); `routes/devicePhotos.isolation.p2102b.test.ts` (**A-13** `@two-tenant` and **C-10** `@two-facility` for both routes, plus "nothing stored, nothing scanned" for a foreign device).
- **Re-based (behaviour changed on purpose):** `controllers/attachment.controller.test.js` — `getSignedDownload` now receives the variant (`undefined` there).
- **Live, PostgreSQL 18, as `callibrator_app`:** `services/devicePhoto.p2102b.live.test.ts` (3: the CHECKs admit a `device` photo with its facility; the replace in one transaction passes `attachments_one_live_device_photo`, which refuses a second live front photo written directly; `device_other` accumulates, the delete is soft).

## Gates

See the P21-06 record — one quiet tree, one run for both cards.

## Not done / open

- **The decode holds the event loop** (~2 s per 12 MP): P22-02 / the app downscale before upload; a worker thread if P21-10's smoke measures contention.
- **The 897 upstream HEIC files:** the ETL converts them outside the application (P24-03; 08 § 11 updated).
- The decode inside the pkg binary is unexercised by a request (boot + route mount proven only).
- P22-02 (device form/list) is unblocked: photos via the two routes, thumbnails via `signed-url { variant: "thumb" }`, HEIC → JPEG in the browser.

# P22-02: the device register page — list, form, type picker, required photos, thumbnails

**Date:** 2026-10-10 · **Task:** P22-02 (Phase 22; F-23 … F-31) · **Specs:** [`P19-03`](../specs/P19-03-device-extensions.md) § 4 – § 8 as built by P21-02a / P21-02b; ADR-132 Am. 2, Am. 3 · **Base commit:** `d0fea5c` · **Resumed:** a halted frontend agent's tree. I finished it rather than restarting it, and found no half-written code (one unused test parameter, now fixed).

> Frontend only. No backend file. `FACILITY_BINDING_ENABLED` is untouched (OFF).

## Built

| Area | What |
|---|---|
| Page | `dashboard/devices/page.tsx` is now a **server component**, as on the P22-01 page. It holds the dictionary from the `locale` cookie, hands the `devices.` namespace to the `DevicesClient` island, and posts the language toggle to `setLocale`. The island carries its own `lang`. |
| List | `GET /calibration-devices` on the **generated client** (`api/services/deviceRegister.service.ts`), with rows from `data` and paging from the top-level `meta`. The P21-02a filters are find, QR, type, condition, status, calibration due, category and, for provider staff only, facility. Loading, empty and failed are three separate states (a failed read shows `ErrorState` with a retry). Columns: front-photo thumbnail, name / QR / serial / "photos missing", type, make · model, facility (unbound users only), room · floor, a condition badge, a status badge, and the next calibration with its due badge. Every row action is named after its device. |
| Form | `DeviceFormDialog` + `register.ts`, which holds the state, the checks and the bodies as plain data. The QR is typed (the server normalises it). The type comes from `TypePicker` (active types only, searched; a held retired type stays shown). The room is a name plus floor, and the server finds it or creates it. The other location options are a store (provider staff only) or none. The form also covers condition, accessories, the inventory date (1990 … today), status, laboratory (`vendors` read), the dates, the calibration interval and the IPM interval (0 … 60). **A bound technician's body never carries a QR, status, laboratory, store or facility** (its contract is strict, so each of these would be a 400). The facility is named on create; it is required when the tenant serves other facilities and preset when only one is open. An edit sends **only the changed fields**, so an untouched condition is not restamped. A 409 (taken QR or serial, ended facility) is shown as the server's explanation, and the form keeps its values. |
| Photos | `PhotosDialog`: front and serial plate. Each photo can be taken (`capture="environment"`), replaced or deleted after a confirmation. After a create the dialog opens in `register` mode, where **Finish** stays disabled until both photos exist; "Finish later" leaves the device as "photos missing". The platform operator never manages photos (A-127); every reader can view them. |
| HEIC / downscale | `lib/photoPrep.ts`: every photo is decoded by the browser (`createImageBitmap`, orientation applied), downscaled to a **2,048 px long edge**, and re-encoded as a **JPEG at 0.85** on a canvas. That also drops EXIF and GPS before upload. HEIC is detected by type, name or `ftyp` brand. Safari / iOS converts it this way, and iOS also converts at pick time because `accept` names JPEG and PNG only. A browser that cannot decode HEIC gets the explained `heic_unreadable` message (set the camera to JPEG). Per ADR-132 Am. 3, no WASM HEVC decoder ships, for the same patent and size reasons as the server. The server's 415 `PHOTO_HEIC_UNSUPPORTED` therefore never arrives from this page. |
| Thumbnails | `PhotoThumb` reads `POST /attachments/:id/signed-url { variant }` (`thumb` in the list, `display` in the dialog) and uses it as a **same-origin path** (CSP `img-src 'self'`). A link is reused for 4 minutes, and there is never a permanent URL. A link that cannot be had shows a named placeholder, not a broken image. |
| Access | Everything follows effective permissions (`usePermissions`), never role names. A bound user gets no facility column or filter, no IoT, no CSV import and no delete (those routes refuse it). |
| Removed | The old `DevicesTable`, `DeviceModal`, `DeleteDeviceModal`, `useDevices` (+ its test). They are superseded; `IotDeviceModal` and the CSV import are kept. |
| Styling | `statusTone.ts` gains the `deviceCondition` domain. Colours come from theme tokens only, so dark mode follows them. |

## Evidence — tests named

- `app/(app)/dashboard/devices/__tests__/page.test.tsx` (22): list states, filters into the query, the bound view, the form bodies (bound / unbound, edit diff), the 409 kept form, the register-mode photo flow with HEIC prep errors, delete and import.
- `__tests__/register.test.ts` (7) and `__tests__/page.server.test.tsx` (2).
- `lib/photoPrep.test.ts` (9): HEIC by type, name and brand; fit within; JPEG name; unreadable; HEIC unreadable.
- `api/services/deviceRegister.service.test.ts` (7).
- `lib/statusTone.test.ts`.
- `components/ui/a11y.adr090.test.tsx`: "DeviceTable (P22-02): every row action is named after the device" (re-based).

## Gates (2026-10-10, Node 26, Windows)

| Gate | Result |
|---|---|
| `npm run typecheck` (frontend) | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npx jest --ci --coverage` | **336 suites, 3,654 tests passed**, 0 failed; 94.31 / 85.84 / 90.18 / 94.97 (gate 90/81/86/91) |
| `node ../node_modules/next/dist/bin/next build` | OK |
| `node scripts/bundle-budget.mjs` | 10/10 within budget, exit 0. Watch item: `/` is at gzip 149.7 / 150 KB; it was 148.7 on 2026-10-05. It is not a P22-02 page. |

## Not done / open

- No live browser, accessibility (light + dark) or responsive run against a server.
- Not tested on a real phone: camera capture, and HEIC on Safari / iOS.
- No offline queue: that is P22-10.

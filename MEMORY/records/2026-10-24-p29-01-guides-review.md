# P29-01 review: one row per facility role, and three pending items named

**Date:** 2026-10-24 · **Card:** P29-01 (DONE 2026-10-23; reviewed) · **Spec refs:** `docs/UPSTREAM/13-USER-GUIDES-ID.md`, `backend/src/constants/facilityAccess.ts` (`BOUND_MENU_CEILING`, `FACILITY_ACCESSIBLE_ROUTES`), migration 0124

## Hook

The guide for facility users treated three roles as one, and it got one of them backwards. It said
the facility technician (`HEALTHCARE TECHNICIAN`) had *narrower* access. In fact that is the only
bound role that can record IPM and register devices. A technician who believed the guide would
never try.

## What changed (Indonesian guide, `docs/UPSTREAM/13-USER-GUIDES-ID.md`)

- **§ 2.1** now gives each facility role its own row: admin faskes, pengguna ruangan, teknisi
  faskes and IPSRS. Each row says what the role can do with IPM, devices and calibration dates, and
  with signatures. The rows are read from `BOUND_MENU_CEILING`, from the grants in 0124 (for
  example, HEALTHCARE TECHNICIAN has `ipm` write and `calibration` write) and from the routes
  marked in `FACILITY_ACCESSIBLE_ROUTES`. One consequence: `POST /calibration-devices/:id/calibration-dates`
  is **not** marked, so a bound technician cannot record a calibration date, and the guide says so.
- **§ 2.3**: the "cannot" row now names the read-only roles. It no longer covers every facility account.
- **§ 6** marks three items **pending**:
  - the run on two real phones (P22-10, P26-02);
  - legacy stickers (**OA-4**; the resolver, P27-02, is not built);
  - old data (the real-data dry run waits on **OA-5** / UD-18).
- The header gains a "Reviewed 2026-10-24" note in English.

The guides now cover each role separately: provider technician (§ 1), the facility roles one by
one (§ 2), provider admin (§ 3) and IPSRS (§ 4). Only built behaviour is described.

## Tests

Docs only. The claims were checked against `constants/facilityAccess.ts` (the ceiling and the
marked routes), `migrations/0124-ipm-menus-technician-calibration.ts` (the grants) and
`routes/api/field.route.ts`. The field app uses the marked device and IPM routes, and its one
route of its own (`POST /wipes`) is for unbound administrators.

**Not checked by running:** a bound technician's screens in a browser. P22's browser suites cover
the facility screens; this review did not re-run them.

## Files

- `docs/UPSTREAM/13-USER-GUIDES-ID.md`
- `TASKS/PHASE-29-UPSTREAM-TRAINING-DOCS.md`
- `MEMORY/CHANGELOG.md`
- `MEMORY/MEMORY-INDEX.md`
- this record

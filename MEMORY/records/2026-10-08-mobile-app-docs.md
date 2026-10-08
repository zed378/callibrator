# The native mobile app documented (TARGET) and the Go-variant mobile phases planned; ADR-135

**Date:** 2026-10-08 · **Item:** BACKLOG D-11 (owner brainstorm and decisions of 2026-10-08), plus the owner's tenant-setup decision of the same day · **Decision:** ADR-135 (Accepted as the plan, not built), with ADR-127's "No Native App" clause superseded (ADR-135 § 9) · **Base commit:** `9e4663b` (working tree, nothing committed) · **Kind:** documentation only. No code, configuration or build change; nothing was run, staged or committed. The shared-packages and backend-for-mobile documentation agent (`docs/SHARED/`, `docs/MOBILE/20`, `21`, ADR-134, Phase 32+) worked in parallel. The shared boards were re-read right before each edit, and only this work's rows were touched.

> **Privacy:** no upstream data value appears in this record or in any document it touched.

## What was asked

1. `docs/MOBILE/` (target): the index, architecture, screens and roles, phone/tablet layouts, offline field capture (the native variant of P19-08), native features, auth flows, security and privacy, distribution and releases, testing, accessibility and i18n, and conventions. Written first, so that the other agent's Node-variant app cards could reference them.
2. The **Go-variant phases** after Phase 999 (Phase 1000+), with the boards updated.
3. An ADR for the mobile architecture.

The owner then added the **tenant setup screen before sign-in**, received from the coordinator mid-task. It was folded into every document and into the Go phases.

## Outputs

| Output | What it decides |
|---|---|
| `docs/MOBILE/00-README.md` | index; two variants, one app; the rules inherited unchanged |
| `01-ARCHITECTURE.md` | Expo dev builds plus CNG; **expo-router** (over React Navigation used directly); state through shared hooks (TanStack Query, memory only) plus Zustand; the mobile auth adapter on the **native ingress** `/native/api/v1`; no Socket.IO in v1; error mapping; feature flags and kill switches; environments |
| `02-SCREENS-AND-ROLES.md` | screens per role (technician unbound/bound, facility staff, IPSRS, auditor signed-out verify, managers); the bound ceiling as the app sees it; tabs and sidebar map; entry points |
| `03-RESPONSIVE-PHONE-TABLET.md` | window classes 600/840 dp from `docs/SHARED/02` § 8; the chrome type chosen once per launch; master-detail in the URL; the two-column / section-pane checklist; dashboards; keyboard; Dynamic Type |
| `04-OFFLINE-FIELD-CAPTURE.md` | SQLCipher DB per user with photos as blobs; key in SecureStore `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`; backup exclusion; iOS reinstall Keychain wipe; screen lock required; OS background limits (OEM killers); no decrypted background uploads; conflict UX with no draft export; purge table; one field user per install; shared-phone guidance |
| `05-NATIVE-FEATURES.md` | in-app `expo-camera` capture; re-encode/EXIF strip; built-in QR scanner; **direct FCM/APNs**, payload = opaque id plus category; biometric module facts; verified app links with `.well-known` files served by the backend |
| `06-AUTH-FLOWS.md` | password + MFA; SSO with a second PKCE and the `/m/sso-return` app link (`20` § 7); native passkeys on `WEBAUTHN_RP_ID`; biometric = app lock, never a key or a signature; rotation; logout/wipe; tenant first |
| `07-SECURITY-AND-PRIVACY.md` | FT rows mapped; MT-01 … MT-16; root stance (attestation → offline refused); **no pinning**; screenshot policy; data at rest; MDM; UU PDP/DPIA addendum, lost-phone breach handling |
| `08-DISTRIBUTION-AND-RELEASES.md` | EAS profiles; Play internal/closed testing and TestFlight; **ABM Custom Apps / unlisted** (iOS), **Managed Google Play** (Android); Enterprise Program and sideloading rejected; signed fingerprint-runtime OTA; 426 policy; ≥ 90-day deprecation; one build for every tenant; Q-M1 … Q-M4 |
| `09-TESTING.md` | jest-expo + RNTL at 90/81/86/91; **Maestro** (over Detox); flows; offline tests; the real-device script on the personal devices available (owner Q-M4: no budget; the 4-device lab a recommended later item); a11y |
| `10-ACCESSIBILITY-AND-I18N.md` | WCAG 2.1 AA in native terms; gestures with alternatives; Indonesian-first shared dictionaries |
| `11-TENANT-SETUP-AND-BRANDING.md` | owner decision: org code / setup link and QR / MDM / email discovery; in-app logo (raster only) plus palette derived in `packages/tokens` with an AA guard → copper, with status tones never tenant-coloured; launcher icon and splash stay Callibrator; the `X-Tenant-Code` hint; one tenant per install; per-tenant sign-in methods; security rules; super admin not in v1 |
| `90-CONVENTIONS.md` | layout, naming, the tokens-only guard, component, a11y, lint, config, tests, commits and releases |
| `TASKS/PHASE-1000-SHARED-PACKAGES-GO.md` | 8 cards: the order decision; the contract document diff; **golden vectors** for the domain rules Go re-implements; a Zod-generated validation corpus; a CI matrix; replay parity; order B build; close-out |
| `TASKS/PHASE-1001-MOBILE-BACKEND-GO.md` | 14 cards: ingress, native auth with reuse detection, install sessions plus fingerprint, SSO exchange, passkeys, push, version policy, attestation, field pieces, **engine-switch continuity both ways**, the parity suite, security review, close-out, **tenant setup (P1001-14)** |
| `TASKS/PHASE-1002-MOBILE-APP-GO.md` | 8 cards: entry, order B build, the E2E matrix on both engines, offline end to end, the real-device script, a **pilot switch plus rollback** with installed apps, release only if the app changed, close-out |
| `MEMORY/DECISIONS.md` | **ADR-135** (decisions 1–14, alternatives, bad implications, Q-M1 … Q-M6); ADR-127 status line notes § 9 |
| Boards | `TASKS/README.md` (three rows), `TASKS/PROGRESS.md` (a planned "Phases 1000 … 1002" section after Phase 999), `TASKS/BACKLOG.md` D-11 (links), `docs/README.md` (the MOBILE folder) |

## Coordination with the other documentation agent

- ADR numbers: ADR-134 is theirs (shared packages, backend for native clients); ADR-135 is this one. In `DECISIONS.md` ADR-134 now precedes ADR-135 (checked at the end of the day).
- I aligned with their documents: the native ingress prefix, the `X-App-*` / `X-Installation-Id` headers, 426 `APP_UPDATE_REQUIRED`, refresh rotation (a crash between rotation and the local write loses the session, which is accepted), window classes, TanStack Query hooks, `/m/sso-return`, and the `.well-known` files on the **backend**. `05` § 5 first said "frontend"; it was corrected with a note, per their `20` § 8.3 and ADR-134 § B.6.
- Tenant-setup IDs come from them: P33-11 (`GET /api/v1/public/tenants/by-code/:code`), P33-12 (hint-scoped sign-in), P33-05 (SSO start by code), P32-02 (palette), P32-06 (hint injector), P34-03 (the setup screen). The setup link is `https://<host>/m/setup?org=<code>`. I confirmed these to them by message.

## Deviations

| Document | Was | Now | ADR |
|---|---|---|---|
| ADR-127 title / alternatives | "No Native App" | a native app beside the PWA; the rest of ADR-127 stands | ADR-135 § 9 |
| `TASKS/PHASE-28` P28-01 (UD-14 "no native app") | unchanged; a dated record of the 2026-10-07 decision | superseded for the app question by D-11, see ADR-135 § 9 | ADR-135 |

## Not determined / not done

- Nothing is built or verified. Every library choice is re-checked by the card that adds it.
- `docs/SECURITY/15` still has to absorb the MT- rows. That is its owner's job, through the mobile security-review card.
- The Node-variant phase files (Phase 32+) were not present when this record was written. Their card IDs are cited from the other agent's message and documents.

## Owner questions (ADR-135)

Q-M1 store organisation identity and app id · Q-M2 hosts compiled into the binary · Q-M3 Android fallback channel · Q-M4 EAS plan and device lab budget · Q-M5 crash reporter sub-processor · Q-M6 super admin in the app (recommendation: not in v1).

## Addendum (same day) — owner answers and the restructure

- **Owner answers (ADR-135):** Q-M2 production domains only in production, the VM host in preview/UAT only; Q-M3 restricted public Play listing (Indonesia, invitation-only sign-in) for customers without Android Enterprise; Q-M4 **no budget for now** — free EAS tier and local builds, emulators, simulators and personal devices, the four-device lab a recommended later item, no release gate requiring a paid service (`docs/MOBILE/08` § 0, `09` § 5, § 7); Q-M5 no crash reporter, scrubbed app logs to our own backend (`01` § 5). Still open: Q-M1, Q-M6.
- **Restructure (ADR-136, owner decision the same day):** the app and the shared packages are one plan (Phases 35 … 40, the other agent's files). `PHASE-1000-SHARED-PACKAGES-GO` and `PHASE-1002-MOBILE-APP-GO` were **dropped** (the golden vectors moved to P32-09; validation and replay parity to the conformance suite, Phase 33; the app's E2E and the pilot move became P1000-15/16). `PHASE-1001-MOBILE-BACKEND-GO` became **`PHASE-1000-MOBILE-BACKEND-GO.md`** (cards `P1001-xx` → `P1000-xx`; 16 cards). Node card ids in `docs/MOBILE` follow the other agent's map (P32→P35, P33→P36, P34→P37). Record of the restructure: [`2026-10-08-contract-first-and-mobile-restructure.md`](./2026-10-08-contract-first-and-mobile-restructure.md).

## Addendum 2 (same day) — audit corrections

A documentation audit (relayed by the coordinator) and owner decisions (A) work-email code lookup, (B) iOS SSO callback, (C) Q-M6 enforced server-side were applied: ADR-135 Amendment 1 lists every correction with the code evidence (`loginDiscovery.service.ts`, `menuGroup.service.ts#getMyPermissions`, `auth.service.ts` 202 MFA answer, `upload.util.ts` `PUBLIC_IMAGE_TYPES`, `tenant.controller.ts#getPublicBranding`, `backend/index.ts` `/.well-known`). `MEMORY/specs/P19-08` § 11.3 gained a note (the wipe order) under the deviation protocol.

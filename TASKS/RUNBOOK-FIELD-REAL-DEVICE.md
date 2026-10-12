# Runbook — The Offline Field App on Real Phones (P19-08 § 16.5)

**Card:** P22-10c3 (P22-10's definition of done; G-28, PT-24; feeds P26-02 field UAT) · **Spec:** [`MEMORY/specs/P19-08-offline-field-capture.md`](../MEMORY/specs/P19-08-offline-field-capture.md) § 16.5 · **Decisions:** ADR-127 + Am. 1 – 5 · **Status:** **OPEN — not run.** The owner runs it; an agent cannot hold a phone.

> **A failure on a real device blocks P22-10's DONE.** Record the run as `MEMORY/records/<date>-field-real-device.md`: the phone model, OS and browser versions, the build's version stamp (Settings shows nothing yet; read `public/sw.js` line 1, `const VERSION = …`), and each step's result. **No screenshot that shows real data** — use the synthetic facility below.

---

## Before you start

| What | How |
|---|---|
| A stack built from the commit under test | the VM, or a disposable stack (`deploy/compose/docker-compose.e2e.yml`) reachable from the phones over **HTTPS** (a service worker needs a secure origin; `localhost` counts only on the machine itself) |
| Synthetic data | as the operator: one client facility (`RS Uji Lapangan`), one device type with a **published** checklist, ten devices with QR stickers printed from the register (synthetic names and serial numbers) |
| Two technician accounts | role TECHNICIAN, **unbound** (provider), passwords set (A-123), MFA enrolled if the tenant asks |
| An administrator account | unbound, tenant administrator level (for step 9's wipe) |
| Phone 1 | a mid-range **Android** phone, current Chrome |
| Phone 2 | an **iPhone**, iOS 17.4 or later, Safari |
| A desktop browser | signed in as the administrator: the dashboard, to check what the phones sent |

---

## The script

Write **PASS** or **FAIL** (with what happened) for each step, on each phone.

1. **Install.** Open `https://<host>/field`, sign in. Android: menu → *Install app*. iPhone: Share → *Add to Home Screen* (offline mode on iOS works only from the installed app). Open the installed app. Settings → *Prepare this phone*: choose the facility, *Check the size* (10 devices shown **before** downloading), *Download*. Settings shows **persistent storage granted** (or says it is not) and the quota.
2. **Airplane mode, killed, reopened.** Turn on airplane mode. Kill the app (swipe away). Open it from the home screen → the field app opens **offline**: Home, the outbox count, the facility with "purged in 72 h unless synced".
3. **Capture offline.** Capture **2 IPMs** with **3 photos each** (on the iPhone one of them **HEIC**: the Camera app's default; expect it accepted — iOS converts at pick time — or refused by name, never lost silently). **Register 1 device** with its two photos, then start its IPM. Halfway through one IPM, **kill the app** and reopen: nothing typed is lost (every change is saved on the phone).
4. **Sync.** Airplane mode off. Home → *Sync now*. On the desktop dashboard: the 3 sessions are **submitted**, each with its visit number, `captured offline`; the new device exists **once**; its photos and the IPM evidence photos are there **once each**; download one stored photo and check it has **no EXIF** (no GPS, no camera serial) — e.g. `exiftool photo.jpg`.
5. **Sign.** On the phone: Home → *Open the signing list* → open each report (online) → Sign. On another device, the facility's countersigning user countersigns (when the tenant has countersigning on).
6. **Sign-out refused.** Start one more IPM and leave it. Settings → *Turn off offline mode* → **refused** with "1 items are not synced". Outbox → *Discard* → type `DISCARD` → it goes; *Turn off offline mode* now works.
7. **The 72-hour purge.** Prepare again, go offline, and either wait 73 h or move the phone's clock **forward 73 h** → open the app: the working set is **purged** (Home: no offline data), the outbox untouched. Separately: prepare again, move the clock **back 5 days**, go **online**, open the app → purged at the first answer from the server (the server's clock decides, PT-24).
8. **Revocation of a lost phone.** Prepare again, airplane mode on. On the desktop, revoke the technician's sessions (Session management → sign out everywhere). Airplane mode off, open the app → the working set is purged at the first contact and the sign-in page appears; the outbox stays for that technician's next sign-in.
9. **A second user on the same phone (AM-23).** Technician A leaves one capture pending and signs out of the dashboard. Technician B signs in on the same phone → `/field` says another user's offline data is on this phone and offline mode cannot be enabled; A's capture is not visible. The administrator signs in on the phone → Settings → *Wipe another user's offline data* → type `WIPE` → done; the dashboard's audit log shows `FIELD_DATA_WIPED` with the counts only.
10. **Update.** Deploy a new build to the stack. Open the app online → Settings shows *An update is ready* → *Update now* → the app reloads on the new version; the outbox (leave one capture pending before the deploy) **survives**.

---

## What the automated suites already prove (so a failure here is a phone problem, not a logic one)

| Check | Where |
|---|---|
| The worker's policy, the shell served offline, no `/api` in any cache, 0 CSP violations offline, an offline capture synced once, a registration with a dependent IPM, the sign-out refusal, AM-23 blocking, axe light/dark, no sideways scroll at 360 / 390 / 768 px | `automate/field.browser.mts` (desktop Chrome, CDP offline) |
| Every screen, the store, the purge rules, the wipe order, the scope fingerprint, a bound user moved F1 → F2 | `frontend/src/field/**/__tests__` |
| A replayed key sends the identical bytes; no photo after a submit; the server ends equal to the phone | `frontend/src/field/engine/__tests__/engine.test.ts` (property test, 40 seeds) |

What only a phone shows: the camera and `BarcodeDetector`, HEIC from the iOS camera, persistent storage grants, installation, iOS's missing Background Sync, a killed app's state, real airplane mode, and a clock moved by hand.

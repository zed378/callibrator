# 05 — Native Features (TARGET)

> **TARGET — nothing here is built.** Library choices below are decisions of ADR-135, made under the
> owner's package rule (packages may be chosen and swapped when the flows are proven by tests, E2E and
> a real-device run). Each is re-checked for maintenance, licence and size by the card that adds it,
> and recorded there.

---

## 1. Camera and the Photo Pipeline

### 1.1 Capture

- **In-app capture with `expo-camera`** (`CameraView` + `takePictureAsync`) is the primary path. The
  system camera app (`expo-image-picker` `launchCameraAsync`) is **not** used for evidence photos:
  some OEM camera apps also save a copy to the gallery, which would put a tenant photo outside the
  encrypted store and every purge rule.
- `takePictureAsync({ exif: false, skipProcessing: false })`, written to the app's **cache** directory
  only.
- **Picking an existing photo** from the library (`expo-image-picker`, library mode) is allowed for
  device photos (a technician who photographed the plate earlier); it goes through the same pipeline.
  The app never **writes** to the photo library (no media-library write permission is requested).
- Permissions: camera only, asked at first use with the purpose text set by the config plugin
  (`NSCameraUsageDescription`, Indonesian and English); a denied permission leaves typed QR entry
  and library pick available and says how to re-enable the camera in settings.

### 1.2 Re-encode and EXIF strip

Same contract as ADR-127 § 5 / P19-08 § 8.1, native means:

1. Refuse a source above 25 MB before decoding (the server's limit is the authority, `docs/UPSTREAM/08`).
2. `expo-image-manipulator`: resize so the long edge ≤ 2048 px, apply the orientation, save as
   **JPEG quality 0.8**. A re-encode writes a new file **without the source's EXIF** (GPS, device
   model and serial, capture time) — HEIC from iPhones is converted in the same step.
3. A unit test on fixture images asserts the output has **no `APP1 Exif` segment**, its long edge ≤
   2048 and it is a JPEG — run on both platforms in the device E2E suite, because the strip is a
   property of the native encoder, not of JavaScript.
4. The bytes go into the field database (`04` § 5) or, online, straight to the upload; the temporary
   files are deleted.
5. **The server never trusts the client's stripping**: it sniffs, scans (ClamAV), strips and converts
   again (P21-02, `docs/UPSTREAM/08`).

Upload: device photos to `POST /calibration-devices/:id/photos` with `purpose`; IPM evidence to
`POST /attachments` (`resourceType` the IPM session, `purpose: ipm_evidence`) **before** the submit;
every upload carries an `Idempotency-Key` (P19-08 G-O8).

## 2. QR Scanning

**Decision: `expo-camera`'s built-in barcode scanning** (`barcodeScannerSettings: { barcodeTypes:
["qr"] }`), which uses the platform's own detectors (ML Kit on Android, AVFoundation/Vision on iOS).
`react-native-vision-camera` with a code-scanner plugin was the alternative: faster frame processing
and more control, but a heavier native dependency we do not need for one QR per scan (ADR-135
alternatives).

- The scanner screen shows a viewfinder with a cut-out, a torch toggle where the camera has one, and
  **typed entry always on the same screen** (accessibility, a damaged sticker, a broken camera —
  `docs/UI-UX/17`).
- Decoded text → `normaliseQrCode(text, tenantSettings)` (shared `domain`, ADR-132 § 1: the tenant's
  prefix and digits, never a hard-coded provider prefix). A URL of the old upstream host is resolved
  by Phase 27's rules (UD-16) when built; until then only a bare number matching the tenant pattern is
  taken out of it.
- Online: `GET /calibration-devices/by-qr/:qrCode` (N-13) — unknown, deleted, another facility's and
  another tenant's QR answer the **same 404**, and the app says only "No device with this QR in your
  access". Offline: a lookup in the working set; not found → "Not in your offline list — register a
  new device or sync later".
- The camera stops on success, on leaving the screen and when the app goes to the background.
- **Verification QR** (`02` § 2.4): the same scanner in the public verify screen accepts only this
  deployment's verification URLs (certificate, IPM report with its token); anything else is refused
  without being opened (no arbitrary URL is ever opened from a scanned code).

## 3. Push Notifications

### 3.1 Transport — direct FCM and APNs (decided)

`expo-notifications` handles permissions, channels, presentation and taps on the device. Tokens are
the **native device tokens** (`getDevicePushTokenAsync`: an FCM registration token on Android, an APNs
token on iOS), registered with **our** backend's push-token registry ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md)), which sends
through **FCM HTTP v1** and **APNs** (token-based auth) directly.

The Expo push service was rejected: it would add another sub-processor that sees every push token and
payload, outside the DPIA's list (`docs/UPSTREAM/06-DPIA.md` § 2.4 sub-processors; UU PDP Art. 51–52 as
read). Google and Apple are unavoidable for delivery; a third party is not.

### 3.2 No personal data in a push (rule)

A push payload carries **only**:

```json
{ "n": "<opaque notification id>", "c": "<category: ipm_due | sign_request | countersign_request | sync_attention | scope_check | generic>" }
```

and a **generic, localised alert** chosen by category on the device side where possible ("You have a
new notification", "An IPM report is waiting for your signature"). **Never** a person's name, a device
name, a serial, a QR, a facility name, a room, a value, a free-text note or a report number — the
lock screen and Google/Apple both see the alert. The app fetches the notification's content from the
API **after unlock** (`GET /notifications`, S-5) and only then shows details.

- `scope_check` is **data-only** (no alert): it asks the app to run `POST /auth/verify` early (`04`
  § 8). Best effort — iOS throttles silent pushes, Android Doze defers them.
- A notification is addressed by the server's rules (ADR-124 § 9: a facility's devices notify that
  facility's bound users who hold the menu, and provider staff — never another facility's users); the
  app adds nothing.
- Android: one channel per category with the importance of the category; iOS: categories with actions
  only where the action needs no data ("Open"). Badge counts come from the server's unread count.
- **Token lifecycle:** registered after sign-in, re-registered when the OS rotates it, **deleted on
  logout** (`DELETE` on the registry) and invalidated server-side when a session is revoked
  ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md)). A token is never reused across users of one install: user B's sign-in
  registers B's token and the server unbinds A's.
- Permission is asked **in context** (after the first IPM capture or on the notification settings
  screen), never at first launch; denied permission degrades to the in-app notification list.

## 4. Biometric Unlock

`expo-local-authentication` + `expo-secure-store`. The flow and its limits are in `06` § 5; the native
facts:

- `hasHardwareAsync`, `isEnrolledAsync`, `supportedAuthenticationTypesAsync` decide whether to offer
  it; the prompt text names the purpose ("Unlock Callibrator"); `NSFaceIDUsageDescription` set by the
  config plugin.
- Fallback to the **device passcode** is allowed (`disableDeviceFallback: false`): the device
  credential is as strong as the biometric gate it replaces.
- A change in enrolled biometrics (a new fingerprint or face added) is detected where the platform
  reports it (iOS `LAContext` domain state through a small module, Android `setInvalidatedByBiometricEnrollment`
  on a dedicated key) and **forces a password sign-in** once — a person who adds their own finger to a
  colleague's phone does not inherit the session.
- Biometrics never sign (`06` § 5): an electronic signature needs the password (and MFA per method).

## 5. Deep Links and App Links

**Verified HTTPS links only for anything that carries a credential or a code**, with one exception
decided by the owner (B, 2026-10-08): on **iOS 16 – 17.3** the SSO return uses a **private
reverse-domain scheme as the `ASWebAuthenticationSession` callback only** (`06` § 3.1) — an https 302
inside the auth session is not delivered as a Universal Link, and the PKCE binding makes an intercepted
code useless. Otherwise custom URL schemes (`callibrator://`) can be claimed by any other installed app
and are used only for development builds and non-sensitive "open the app" links.

| Link | Platform mechanism | Hosted file |
|---|---|---|
| `https://<platform host>/verify/<certificateNumber>` (as built on the web: `frontend/src/app/(public)/verify/[certificateNumber]`) and the IPM link `<IPM_VERIFY_BASE_URL>/<reportNumber>?t=<token>` (P19-06 spec § 9.1 — by default `CERT_VERIFY_BASE_URL` + `/ipm`) | iOS **Universal Links** (`applinks:<host>` associated domain), Android **App Links** (`autoVerify`) | `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` |
| `https://<platform host>/m/sso-return` (SSO return, [`20`](./20-BACKEND-FOR-MOBILE-NODE.md) § 7) | Android App Link; iOS 17.4+ the auth session's https callback; iOS 16 – 17.3 the private scheme (`06` § 3.1) | the same |
| `https://<platform host>/d/...` or the device page of P21-08 | the same | the same |
| passkeys for the platform RP ID | iOS `webcredentials:<host>`; Android Digital Asset Links `delegate_permission/common.get_login_creds` | the same two files (`06` § 4) |

- The two `.well-known` files are **served by the backend** ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md)
  § 8.3, ADR-134 § B.6): as built, the edge routes `/.well-known/` to the backend in every reference
  deployment (it already serves ACME challenges there), so no edge change is needed. They are built
  from runtime configuration (`MOBILE_IOS_APP_IDS`, `MOBILE_ANDROID_APPS` with the signing-certificate
  fingerprints — Android: the Play app-signing key and, for preview, the upload key), served as
  `application/json`, with no redirect and no authentication; a server test asserts their content
  against the configuration, and Apple's and Google's validators are run against the deployed host.
  *(This paragraph first said "served by the frontend"; corrected 2026-10-08 to the as-built routing
  that `20` § 8.3 found — the deviation is recorded in ADR-134 § B.6 and this document's record.)*
- Hosts are **build-time**: the associated domains and app-link hosts are compiled into the binary.
  A tenant's **custom domain** (Phase 4) is therefore **not** an app-link host: links on a custom
  domain open the web page; the app is reached through the platform host. **Owner, 2026-10-08
  (Q-M2):** the `production` binary names the **production domain(s) only**; the reference VM
  (`kalibrasi.zedth.my.id`) is a platform host of the **`preview`/UAT** binary only.
- **Verification paths mirror the web exactly.** The app's routes are laid out so that the web's URLs
  are the app's URLs: `app/(public)/verify/[certificateNumber].tsx` and
  `app/(public)/verify/ipm/[reportNumber].tsx` (reading `t`). Where a printed URL cannot be mirrored
  (the API-form fallback `…/api/v1/ipm/verify/<n>?token=` of P19-06 § 9.1), an expo-router
  **`+native-intent`** rewrite maps it to the same screen. A test feeds every URL form the backend can
  print (`resolveVerifyUrl`) to the router and asserts the screen.
- **Signed-out allow-list of verification hosts:** the verify screens and the scanner (§ 2) accept
  only the hosts compiled into the build (the production domain(s); in `preview`, also the reference
  VM — owner Q-M2) **plus** the configured server's host; any other host is shown as text and never
  fetched (MT-14).
- Every incoming link is parsed by `expo-router` into a route; a route the session cannot reach shows
  "not available" (`02` § 1); a verification link works signed out; an SSO return is accepted **only**
  if it matches the pending sign-in's `state` (`06` § 3).

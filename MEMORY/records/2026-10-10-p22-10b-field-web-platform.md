# P22-10b: the field app's web platform — encrypted IndexedDB, the registry, the service worker, the manifest, CSP, camera, proxy

**Date:** 2026-10-10 · **Task:** P22-10b (Phase 22; P22-10 split a / b / c, see the P22-10a record) · **Specs:** [`P19-08`](../specs/P19-08-offline-field-capture.md) § 3.1, § 4 – § 7, § 11; `docs/SHARED/06-SYNC-ENGINE.md` § 4 (the web column); ADR-127 + Am. 1, Am. 2 · **Base:** after `b5b97e2`

> Frontend only. **There is still no `/field` page**: that is P22-10c. Nothing registers the worker until P22-10c's Settings screen asks the user. The owner told me to stop after this card, so **P22-10c has not been started.**

## Built

| Area | What |
|---|---|
| Encryption (`field/platform/crypto.ts`) | AES-GCM-256 under a **non-extractable** `CryptoKey`. Each record gets a fresh 96-bit IV and **the record's slot as AAD** (`<store>/<key>/<schemaVersion>`), so a ciphertext moved to another slot does not decrypt. No password-derived key and no PIN, per ADR-127. |
| Store (`field/platform/idbStore.ts`, `idb.ts`) | The engine's `CaptureStore` (plus the working-set reads P22-10c needs) over IndexedDB, one database per user (`callibrator-field-<tenantId>-<userId>`). Stores: keys, meta, catalogue, workingSet, rooms, captures, ops (indexed by capture), photos. Clear fields hold **only** ids, states, timestamps and counts. Payloads are sealed before their transaction opens, because IndexedDB closes a transaction that waits on WebCrypto. `dropWorkingSet` clears only catalogue, workingSet and rooms. Deleting a capture also deletes its ops and photos. `destroy` deletes the database. A transaction whose work fails writes nothing. |
| Registry (`field/platform/registryStore.ts`) | `callibrator-field-registry` holds rows of `key`, `outboxCount`, `workingSetPresent` and `lastSyncServerAt`. Any extra field passed in is dropped. The `cf.field.present` flag is set with the first row and cleared with the last. A storage that throws (a private window) is tolerated. |
| Service worker (`field/worker/sw.ts` → **generated** `public/sw.js`) | `scripts/build-sw.mjs` transpiles it with the TypeScript compiler API (imports refused, every `export` dropped), stamps a 12-hex source hash as the version, and has a `--check` mode. The worker's whole policy: a `/field` navigation is network-first with a 3 s timeout, keeping a 200 HTML response that carries a CSP as **the** shell; offline it serves that shell, or a plain-text offline page with no script. Static files (`/_next/static`, fonts, brand) are cache-first. The manifest is network-first. **Everything else passes through and is never cached** (FT-84). Install fetches the shell and its referenced static files, or the install fails. Activate deletes the `cf-*` caches of other versions and claims clients only on the first install. `SKIP_WAITING` comes only from the user. Background Sync only posts `cf-sync` to an open page. No `importScripts`, `eval` or library. `npm run build` now runs `build-sw` first; `sw:build` / `sw:check` scripts added. |
| Registration (`field/platform/serviceWorker.ts`) | Registers `/sw.js` with scope `/field`, classic, `updateViaCache: "none"`. Unregistering removes only the field worker and the `cf-*` caches. `missingFeatures` names what a browser lacks. `persistence` calls `persist()` and reads the quota. `applyUpdate` applies a waiting worker only on the user's word. |
| Transport (`field/platform/transport.ts`) | The engine's `Transport` over the app's axios client, so it gets the same refresh-once and error normalisation. It sends the **frozen body text byte for byte** with `Idempotency-Key` and `X-Field-Client: 1`; a photo goes as multipart with its fields. It maps every HTTP answer, including `code`, `draftId`, `Retry-After` from the body or the header, and `Date`. No answer → reject. A 401 → `SessionEnded`. `verify` reads `scopeFingerprint`. |
| Browser ports (`field/platform/browserPorts.ts`) | Clock, random bytes, `onLine`, a cancellable timer, and a bounded in-memory diagnostics log (200 events, no tenant data, never sent anywhere). |
| CSP / headers | `worker-src 'self'` and `manifest-src 'self'` on every page, with no `wasm-unsafe-eval`. **`camera=(self)` now on `/field` as well** (`CAMERA_PAGES`, ADR-127 Am. 1 § 8 and Am. 2). `next.config.ts`: `/sw.js` gets `text/javascript`, `no-cache, max-age=0` and its own worker CSP `default-src 'none'; connect-src 'self'; script-src 'self'`; `/manifest.webmanifest` gets `application/manifest+json`. |
| Proxy | `PROTECTED_PREFIXES = ["/dashboard", "/field"]`. `/field` is matched exactly or as a path prefix, so `/fieldwork` is not protected. The matcher excludes `sw.js` and `manifest.webmanifest`, so neither gets a nonce page CSP. |
| Manifest + icons | `public/manifest.webmanifest`: id, scope and start URL in `/field`, standalone, `lang: id`. Its colours are the light tokens `--background` / `--foreground`, and a test keeps them equal. `public/brand/icon-192.png`, `icon-512.png` and `icon-maskable-512.png` are generated from the brand mark by `scripts/gen-field-icons.mjs` (sharp). |
| Dev dependency | **`fake-indexeddb` ^6.2.5** (Apache-2.0, no dependencies, dev only). It is a real IndexedDB implementation for node tests, so the store is tested against an IndexedDB rather than a mock. The audit gate reports 0 failing and 0 in the production tree. |

## Evidence — tests named

New:
- `field/platform/__tests__/idbStore.test.ts` (5). Every record round-trips. **At rest:** no tenant value (name, QR, note, `clientRef`, device id, API path) appears in any raw row of any store, and the raw capture and op rows have exactly the expected clear keys. The key is non-extractable (`exportKey` rejects) and survives a reopen. The wrong slot and another user's key both fail to decrypt. A purge leaves the outbox intact. Deleting a capture cascades. `destroy` works. A failing transaction writes nothing. The registry stores ids and counts only and handles the flag and a throwing storage.
- `field/platform/__tests__/serviceWorker.test.ts` (5).
- `field/platform/__tests__/transport.test.ts` (4): the exact bytes and the key, multipart, the answer mapping, `SessionEnded`, `verify`.
- `field/platform/__tests__/browserPorts.test.ts` (1).
- `field/platform/__tests__/fieldInstall.guard.test.ts` (4): no route other than `/field` starts with `/field`; manifest content, token colours and icons; the worker's headers and the camera pages; only `field/platform/serviceWorker.ts` registers a worker.
- `field/worker/__tests__/sw.test.ts` (10): the policy; shell kept, served offline and on timeout, plus the offline page; cache-first and network-first; API passthrough; install and activate; `SKIP_WAITING`; sync. **The generated `public/sw.js` is current**, has no import, export, `importScripts` or `eval`, parses as a classic script, and wires all five handlers in a `vm` context. The source's own wiring is checked under worker globals.

Re-based:
- `lib/securityHeaders.test.ts`: +1 for `worker-src` / `manifest-src` and no wasm; `CAMERA_PAGES` now includes `/field`.
- `proxy.test.ts`: the matcher excludes `sw.js` and the manifest; `/field` is protected and `/fieldwork` is not.

## Gates (2026-10-10; per-card rule)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npx jest --ci --findRelatedTests <changed sources>` | 9 suites, 72 tests passed. All field, proxy and CSP suites together: **11 suites, 109 tests passed** |
| `node scripts/build-sw.mjs --check` | current (version `daf93407b2bb`) |
| `node ../node_modules/next/dist/bin/next build` | OK |
| `node scripts/bundle-budget.mjs` | 10/10 within budget, exit 0 (`/` 150.0 / 152 gzip) |
| `node scripts/ci/npm-audit-gate.js` | 0 failing, production tree 0 |

Coverage of the new platform code: crypto, browser ports, the service-worker registration and `proxy.ts` at 100 %; `idbStore.ts` 98.87 / 96; `transport.ts` 98.14 / 91.42; `sw.ts` 98.3 / 95.52. **`idb.ts` error branches are at 30 % branch coverage**: the open / blocked / request-error handlers. A test for the blocked upgrade timed out under `fake-indexeddb` and was removed rather than left flaky.

## Not done / open

- **P22-10c is not started** (the owner said to stop): the `/field` layout and screens, the working-set download, wiring the purge triggers into `client.ts#endSession`, the profile guard in the authenticated shells, the administrator wipe, the `fieldShellNoTenantData` guard (it needs the field page), the browser suites (P19-08 § 16.3), and the real-device script (§ 16.5).
- The `idb.ts` error-branch tests mentioned above.
- The Dockerfile and CI call `next build` directly. `public/sw.js` is committed and checked by `sw.build` / `sw:check`, so it stays current without `npm run build`.

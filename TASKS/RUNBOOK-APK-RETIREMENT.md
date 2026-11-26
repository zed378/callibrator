# P28-03 — APK and upstream API retirement

Prepared 2026-11-25. **Not an executed retirement.** Depends on the owner's
cutover decision, the completed dual-run window and the Phase 31 archive gate.

## Before the window

Prepare this notice for the provider to review. Do not send it automatically.
Confirm the new origin, retirement time and contact for access or offline drafts.
Replace brackets before use.

> Mulai [tanggal dan zona waktu], APK dan API aplikasi lama dihentikan.
> Gunakan [alamat aplikasi web baru] melalui peramban. Simpan pekerjaan yang masih
> ada di perangkat lama sebelum waktu tersebut bersama petugas pendamping;
> jangan memasukkan pekerjaan yang sama dua kali. Panduan penggunaan dan mode
> luring tersedia pada aplikasi baru. Hubungi [petugas] jika belum menerima
> undangan akun atau masih mempunyai pekerjaan yang belum terkirim.

There is no automatic migration of the APK's local unsent state. Do not claim the
new PWA received it without checking issued records in the new system.

## Deploy the prepared boundary

1. Save the old virtual-host configuration; verify archive and restore evidence.
2. Render `deploy/compose/nginx/retired-upstream.conf.template` with only
   `LEGACY_HOST` and `APP_ORIGIN` substituted. The origin must be the reviewed
   HTTPS application origin without trailing slash. Preserve nginx variables.
3. Render `retired-upstream.html.template` and the existing
   `legacy-stickers.notice.html.template` with those same substitutions. Install
   as `/usr/share/nginx/html/legacy-stickers/retired.html` and `notice.html`.
   Install the config in nginx's `http` context.
4. Replace the old PHP-serving virtual host with this complete boundary. Do not
   append it beside a second virtual host that still exposes the old app.
   Keep the operator's HTTPS terminator; run `nginx -t` before reload.
5. At the approved window, remove the APK from all served document roots and
   CDN/cache origins, stop the old application/API listener and reload nginx.
   These production actions require the operator's execution record.
6. Verify GET and POST on `/api_v1/loginUser`, the APK URL and old app/PDF
   paths: **410**, no upstream data or redirect to a data endpoint. A valid
   `/readQr/<alphanumeric>` retains only the static P27-02 sign-in notice.
   Probe the public host and any known direct origin; a CDN 410 alone does
   not prove the PHP listener or APK origin is retired.

## Local verification and rollback

`rtk proxy node scripts/upstream/retired-upstream-check.mts` starts an isolated
nginx and tests GET/POST 410, privacy headers, fixed app link and legacy notice.
It contacts no production host and removes its container and temporary files.

Before reload, rollback restores the saved virtual-host config after `nginx -t`.
After new application writes, do not reopen writes in the old app: the cutover
runbook's fix-forward rule applies. Keep the legacy notice while its hostname is
maintained. Removing application files/revoking credentials belongs to Phase 31.

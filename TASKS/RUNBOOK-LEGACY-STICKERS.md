# Legacy sticker notice - P27-02

Owner confirmation 2026-11-25: both bare codes and URLs occur. The upstream route
is /readQr/(:alphanum), in app/Config/Routes.php.

## Prepare

1. Set LEGACY_HOST to the old hostname and APP_ORIGIN to the new HTTPS origin,
   without a trailing slash. These are operator-supplied deployment values.
2. Render deploy/compose/nginx/legacy-stickers.conf.template and
   deploy/compose/nginx/legacy-stickers.notice.html.template with envsubst, restricting
   substitution to APP_ORIGIN and LEGACY_HOST. Preserve nginx's $sticker and
   $binary_remote_addr variables.
3. Install the rendered config under nginx's http context (for example
   /etc/nginx/conf.d/legacy-stickers.conf); install the rendered HTML as
   /usr/share/nginx/html/legacy-stickers/notice.html.
4. Serve the old host through its existing HTTPS terminator. Run nginx -t first.
   Do not reload the production host without the operator's cutover decision.

## Verify before cutover

- A synthetic /readQr/QR000123 and an unknown code give a replaced-sticker notice,
  no device facts, and no public device lookup.
- The sign-in link points only at APP_ORIGIN; callbackUrl is the local
  /dashboard/ipm/new?qr=QR000123 path.
- Sign in as the intended technician: the QR field is pre-filled. Find performs
  the existing authenticated lookup; another facility's code is 404.
- Cache-Control: no-store, noindex, no-referrer and a restrictive CSP are present.
- A burst above the request budget returns 429 (30/minute, burst 10 per address).
- For a bare code, type/scan it at Dashboard > IPM > Start an IPM. A full legacy
  URL can also be typed/pasted or read by the existing camera scanner; the
  browser extracts its last path segment locally and never visits the old URL.

## Rollback and limitations

Restore the old host's saved nginx configuration and reload only after nginx -t.
This delivers deployment artefacts, not an executed host cutover. No data or token
mapping is stored. New capability stickers continue through /d/<token>.
Physical-device scans are excluded by the owner's 2026-11-25 instruction.

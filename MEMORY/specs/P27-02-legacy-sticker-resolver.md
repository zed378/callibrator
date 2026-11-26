# P27-02 - Legacy sticker resolver

Status: implementation, 2026-11-25.
Spec refs: P19-07 section 11; ADR-138 G-2; Phase 27; upstream
app/Config/Routes.php (/readQr/(:alphanum)).

## Owner decisions

2026-11-25: both bare device codes and URLs occur on legacy stickers.
Work ends at Phase 31; large dashboard redesign deferred; real-device tests excluded.

## Behaviour

- Camera, typed and handheld-scanner input use the same existing code extraction.
  A URL is parsed locally, never fetched or opened.
- /dashboard/ipm/new?qr=<code> pre-fills the sticker field; lookup requires an
  explicit Find action under existing permissions and facility-scoped API.
- The sign-in callback preserves the query so a pre-filled sticker survives login.
  Existing same-origin callback validation remains authoritative.
- The legacy host can serve a rate-limited static replaced-sticker notice on
  /readQr/<alphanumeric code>, with a link to sign in and the pre-filled lookup.
  It performs no device lookup, issues no capability token, exposes no device facts,
  and sends no-store, noindex and no-referrer headers.
- Deployment is an operator action: provide the legacy host and the new HTTPS
  application origin. A template is delivered; it is not deployed automatically.

## Verification

Frontend: typed URL and prefill flow, callback query preservation, existing scanner
and permission tests, typecheck and production build.
Infrastructure: render the nginx template with synthetic domains; nginx -t and
real HTTP checks for notice, headers, safe callback and request budget.
Backend: existing two-facility QR lookup and cross-tenant tests.

No real QR value, domain credential or upstream device data enters this repository.

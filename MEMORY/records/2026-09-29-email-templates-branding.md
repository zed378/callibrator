# 2026-09-29 — Email templates: brand logo, brand palette, truthful copy

**Owner request:** the templates in `backend/src/templates` should use the existing logo and colours consistent with the application.

## What was wrong

- **Logo:** the logo (`frontend/public/brand/logo-email.png`, a 480×200 wordmark) was placed three times per template:
  - a 600 px image with `max-height:0` (a hidden spacer left from the boilerplate);
  - a 100 px header;
  - a 35 px footer icon, where the wordmark was illegible.
- **Colour:** the templates used `#669ae9` and the notification email used `#4f46e5`. Neither is in the logo (navy `#001250`, teal `#00DAB4`, `frontend/public/brand/mark.svg`) or in the app tokens.
- **Copy was another product's boilerplate:**
  - "register as one of our students", "your dream to get $1000++ jobs", "Follow the quests";
  - a fictional address, "Jalan Antahberantah Tepi Bumi 17A";
  - `account.html`: "your student just submitted a submission".

## What changed

- **`template.html` (activation), `otp.html`, `account.html`:** rewritten on one bulletproof table layout:
  - inline styles only, with an Outlook VML button;
  - the logo once in the header (192 px, alt = app name), linked to the app;
  - a 4 px teal top bar and a navy CTA;
  - slate neutrals from `globals.css` (ADR-090);
  - Indonesian first, then a short English paragraph.
- **Copy states only what the code does:**
  - the activation link is valid 24 h (`jwt.util.ts` `PURPOSE_TOKEN_TYPES.activation`);
  - the OTP is valid 5 minutes (`auth.service.js`, `OTP_EXPIRY_MINUTES`).
- **Placeholders are unchanged,** so `email.service.js` needs no change for the templates.
- **`email.service.js` `sendNotificationEmail`:** same palette and a header logo. The footer markup is unchanged; `email.service.test.js` pins it.
- **`tests/services/email.templates.test.js`:** three new checks, each run on every template:
  - no boilerplate copy;
  - the brand palette present and no off-brand blue;
  - exactly one `<img>`, with alt text.

## Evidence

- `npx jest src/tests/services/email.service.test.js src/tests/services/email.templates.test.js`: 26 passed.
- `npx eslint` on both changed files: clean.

## Left open

- `account.html` (which emails a password) has no caller today. If a caller is added, it must use the one-time, must-change mechanism from the super-admin bootstrap work (same date), not a reusable password.
- Rendering has not been checked in real mail clients (Outlook, Gmail, Apple Mail).

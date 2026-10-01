# Owner brief — landing, login, register, public verification (2026-09-29)

Answers the owner gave in the brainstorming round. These are decisions, not proposals; the
research files 04 and 05 and the hi-fi mockups follow them.

| Topic | Decision |
|---|---|
| Mood | **Dark cinematic** — near-black, soft light/gradients, large type |
| Hero visual | **Real product UI + abstract precision motif** (screenshots over a backdrop) |
| Audience | Calibration labs · biomedical engineering / IPSRS · hospital leadership |
| Primary CTA | **Contact sales / WhatsApp** (owner supplies number + email; placeholders until then) |
| Register | **Request access** — institution + contact + needs; super admin approves and creates the tenant |
| Request-access storage | **New public endpoint** (rate-limited, honeypot, no captcha) **+ super-admin approve/reject queue** that creates the tenant |
| Login layout | **Cinematic split-screen** — dark visual panel left, form right |
| Sign-in methods shown | Email + password (TOTP MFA when enabled) · SSO (SAML/OIDC) · Passkey (WebAuthn) |
| Social proof | **Remove** all unverified numbers, testimonials and client logos; replace with verifiable facts |
| Accent | **Electric teal/cyan** on neutral dark (one accent) |
| Typography | **Serif display + sans body** (free-licence fonts) |
| Motion | **Subtle & premium**, honours `prefers-reduced-motion` |
| Language | **ID + EN toggle, Indonesian default** |
| Landing sections | Hero · core features + workflow story · compliance & security (supports, not "certified") · public certificate verification · FAQ + contact |
| Pricing | Not shown — contact sales |
| Brand | Keep the current Callibrator logo and name |
| Public verification page | Revamped in the same style |
| Process | **Hi-fi HTML mockups first → owner approval → implementation** |
| Assets | Free for commercial use only; licence recorded per asset |
| Copy | Remove over-claims and over-promises; the platform *supports* compliance, it is not itself certified |

Constraints that still bind the implementation: nonce CSP (ADR-071 — no inline script, no
un-nonced style, no third-party image origins, so fonts and images are self-hosted), one `<main>`
and one `<h1>` per page, theme tokens (ADR-090), WCAG 2.1 AA, React Compiler lint.

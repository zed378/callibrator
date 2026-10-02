# 20 — Landing, Sign-in, Request Access and Verification Revamp (Phase 10)

**Written:** 2026-09-29 · **Status:** design spec for [`TASKS/PHASE-10-LANDING-AUTH-REVAMP.md`](../../TASKS/PHASE-10-LANDING-AUTH-REVAMP.md). Nothing here is built yet. · **Decision record:** ADR-098 in [`MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md).

**Binding input:** the owner's answers in [`research/00-owner-brief-landing-auth.md`](research/00-owner-brief-landing-auth.md), and the **working decisions set by the coordinating session** on 2026-09-29 for the follow-up questions (product name, accreditation wording, the register endpoint, invitations, passkeys as MFA, request retention, certificate enumeration, contact channels, no pricing and no trial). The coordinating session reported that the owner delegated these to it; that delegation is not recorded first-hand anywhere in the repository, so each is written in ADR-098 §8 and in [`TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) (Q-39 … Q-47) as a **working decision awaiting the owner's confirmation**. Work proceeds on them; the owner can overturn any. Where the research recommends otherwise, the owner's answer stands and the research view is recorded in ADR-098 as the rejected alternative.

**Product name on every public surface: "Device Calibrator"** (working decision, ADR-098 §8.1, awaiting owner confirmation). It matches the logo and `APP_NAME`'s default. "Callibrator" is the repository and codename and never appears in public copy; "HDC" is not used. This document says "Callibrator" only when it means the codebase.

**Evidence used:** [`research/04-competitor-landing-and-auth.md`](research/04-competitor-landing-and-auth.md) (competitors, auth patterns, claim rules, current-page audit), [`research/05-landing-auth-audit.md`](research/05-landing-auth-audit.md) (the as-built code audit: every current string classified with evidence and ID/EN rewrites, the 16 verifiable facts in its §3.14, assets, auth security, the request-access gap), [`research/02-standards-and-benchmarks.md`](research/02-standards-and-benchmarks.md) (WCAG, Part 11, locale formats), and the code files named in each section. Where 05 and 04 differ, 05 wins on **what the code does** (it read every file) and 04 on **market and legal practice**. Copy-deck rows cite 05's row ids (H3, W4, C6 …) where 05 supplied the rewrite.

**What this document replaces, and where:**

| Document | What changes | Where it is recorded |
|---|---|---|
| [`19-IMMERSIVE-REVAMP-PLAN.md`](19-IMMERSIVE-REVAMP-PLAN.md) Part I (landing, login, register) | **Superseded.** No WebGL 3D hero, no Lenis, no GSAP, no testimonials, no pricing, no badge chips. Part II (blog and news) stays in force | ADR-098 §1 |
| [`14-PUBLIC-SURFACES-UX.md`](14-PUBLIC-SURFACES-UX.md) § Landing, § Auth Screens | The landing section list, "Trust: the standards" row, and "Pricing" row; "auth screens deliberately plain" becomes the cinematic split-screen with a light budget | ADR-098 §2 |
| [`00-DESIGN-DIRECTION.md`](00-DESIGN-DIRECTION.md) § Language | Public surfaces become **Indonesian by default with an English toggle**. The dashboard is unchanged until Phase 11 | ADR-098 §4 |
| [`07-TYPOGRAPHY.md`](07-TYPOGRAPHY.md) | A third family, a serif display, on **public surfaces only** | ADR-098 §3 |
| [`08-COLOR-SYSTEM.md`](08-COLOR-SYSTEM.md) | A dark-only **public palette** scoped to public surfaces; the tenant colour is not applied on them | ADR-098 §3 |

---

## 1. Goals and Non-Goals

**Goals**

1. A hospital buyer who lands on the page understands within one screen what Device Calibrator is, and can reach a person (WhatsApp or email, whichever is configured) in one click.
2. Every sentence on the public surfaces is **true today and traceable** to a code file or a `docs/` document (§11). The platform *supports* compliance; it holds no certification.
3. The page feels **premium and grand** (*mewah dan megah*) through restraint: large serif display type, near-black space, one teal accent, the real product, one in-house precision motif.
4. Sign-in meets WCAG 2.1 AA (it fails SC 1.3.5 today), has a forgot-password path (missing today), stops asking users for a SAML/OIDC protocol, and does not enumerate accounts.
5. `/register` stops promising a workspace it does not create and becomes **Request access**, backed by a real queue a super admin works.
6. Indonesian first, English one click away, on every public page.

**Non-goals**

- Pricing. The owner chose "contact sales"; no prices, no tiers, **no trial** (ADR-098 §8.9).
- Social proof of any kind until real, permitted customer material exists (research 04 Q3).
- The admin dashboard. That is Phase 11, on hold.
- A self-serve trial or sandbox tenant.
- A blog or news redesign (19 Part II stays).

## 2. Audience

| Reader | What they need from the page | Where they get it |
|---|---|---|
| **Calibration laboratory** (the provider admin, persona Dewi in [`03-PERSONAS.md`](03-PERSONAS.md)) | Records an assessor asks for: traceability, uncertainty, signed certificates, a public verification link | Workflow story (§6.3), verification demo field (§6.5) |
| **Biomedical engineering / IPSRS** (Kepala IPSRS, the technician Budi) | Knowing which device is due before it is overdue; less paper before a survey | Hero, workflow story |
| **Hospital leadership** (director, quality committee, procurement) | That this is serious, supported, and will not embarrass them in front of a surveyor; whom to call | Compliance & security (§6.4), FAQ, contact |
| **An auditor or surveyor with a phone** | The verdict on a certificate, instantly | `/verify` (§10) |

The anonymous auditor is the only reader who arrives without being sold to; the verification page spends nothing on impression (14 § The Verification Page, unchanged).

## 3. Principles for This Surface

1. **Cinematic, not theatrical.** Dark, large type, slow light. No gradient text, no magnetic buttons, no count-up numbers, no floating chips, no pulsing "live" dots, no marquee (research 04 §2.3).
2. **The product is the hero image.** Real UI rendered crisply, labelled *Contoh data / Sample data*. Never a stock clinician.
3. **One motif, owned.** A precision scale: graduation ticks, a tolerance band, a needle settling inside it. Drawn in SVG in-house (§12).
4. **Every claim has a source.** If §11 cannot cite a file or a document for a sentence, the sentence does not ship. P10-11 makes this a test.
5. **One accent.** Teal `#00DAB4`, the brand's own (08 § The Product's Own Brand). Status colours appear only where they carry a status (the verification verdict, form errors).
6. **Motion explains or it goes.** Every animation has a static equivalent that is complete, not degraded.

---

## 4. Tokens

### 4.1 Scope

The public palette is a **separate token set** applied by a `data-surface="public"` attribute on the public layouts (landing, `/login`, `/request-access`, `/forgot-password`, `/verify/*`, `/activation`). The dashboard tokens in `frontend/src/app/globals.css` (ADR-090) are **not changed**. The public surfaces are **dark only**: they do not follow the `.dark` class or the stored theme preference (owner brief: "dark cinematic"; ADR-098 records the accessibility cost).

Tenant colour (`tenants.primaryColor`, `TenantBrandingProvider`) is **not applied** on public surfaces; today it overrides `--primary` on the auth pages, so a tenant colour that fails on near-black would break the sign-in button (05 §5.8). A tenant-pinned login shows the tenant's **logo and name** only. An arbitrary tenant colour cannot be contrast-checked against near-black in advance, and a second accent breaks the one-accent rule.

### 4.2 Colour, with computed contrast

Ratios are WCAG 2.1 relative-luminance ratios, computed 2026-09-29 with the formula in SC 1.4.3 (script kept in the P10-01 record; P10-01 re-runs it as a unit test so the table cannot drift from the CSS).

**Surfaces**

| Token | Hex | Use |
|---|---|---|
| `--pub-bg` | `#0A0C0F` | page background (near-black, not pure black: 08 § Dark Theme, halation) |
| `--pub-surface` | `#12161B` | cards, form panel |
| `--pub-raised` | `#1A2027` | inputs, popovers, the verdict card |
| `--pub-glow` | `#092926` at most | the brightest point of any accent glow (`color-mix(in srgb, #00DAB4 14%, #0A0C0F)`); **text may sit on a glow only if it passes against this value** |

**Foreground, ratio against each surface**

| Token | Hex | on `bg` | on `surface` | on `raised` | on `glow` | Permitted use |
|---|---|---|---|---|---|---|
| `--pub-text` | `#EEF2F6` | **17.41** | 16.14 | 14.59 | 13.76 | all text |
| `--pub-text-muted` | `#A3AEBA` | **8.69** | 8.06 | 7.28 | 6.87 | body copy, secondary text |
| `--pub-text-subtle` | `#8A95A1` | **6.43** | 5.96 | 5.39 | 5.08 | captions, footnotes, placeholders |
| `--pub-accent` | `#00DAB4` | **10.90** | 10.11 | 9.13 | 8.61 | links, primary button fill, focus ring, the motif |
| `--pub-accent-hover` | `#3DE8C9` | 12.67 | 11.75 | 10.61 | — | hover fill |
| `--pub-accent-pressed` | `#00B899` | — | — | — | — | pressed fill |
| `--pub-on-accent` | `#0A0C0F` | — | — | — | — | text on the accent: **10.90** on accent, 12.67 on hover, 7.75 on pressed |
| `--pub-border` | `#2A323C` | 1.51 | 1.40 | 1.27 | — | **decorative dividers only**; never an input or control boundary |
| `--pub-border-strong` | `#6B7684` | **4.24** | 3.93 | 3.55 | — | input and control boundaries (SC 1.4.11 needs 3:1) |

**Status, public surfaces only**

| Token | Hex | on `bg` | on `surface` | on `raised` | Use |
|---|---|---|---|---|---|
| `--pub-success` | `#4ADE80` | 11.24 | 10.42 | 9.42 | verdict VALID |
| `--pub-warning` | `#FBBF24` | 11.73 | 10.88 | 9.83 | verdict EXPIRED / NOT YET VALID |
| `--pub-danger` | `#FB7185` | 7.28 | 6.75 | 6.10 | verdict REVOKED / WITHDRAWN, form errors (5.75 on glow) |
| `--pub-neutral` | `#CBD5E1` | 13.19 | 12.23 | 11.05 | verdict NOT FOUND |

**Forbidden pairings (each fails, measured):**

- White on the accent: **1.80**. The primary button's label is `--pub-on-accent`, never white.
- The navy mark `#001250` on `--pub-bg`: **1.12**. Public surfaces use `mark-dark.svg` (or `BrandIcon` with `currentColor` white).
- `--pub-border` as an input boundary: 1.51. Inputs use `--pub-border-strong`.

**The accent and "success" are the same luminance** (accent vs `--pub-success`: **1.03**). They differ only in hue (≈169° vs ≈142°). So: the accent never appears inside or beside the verification verdict card, and every status is carried by its **word and icon** (08 § Never Colour Alone). This is the concrete form of 00's rule that the brand accent must not read as a status.

### 4.3 Typography

| Role | Family | Licence | Weights loaded | Used for |
|---|---|---|---|---|
| Display | **Instrument Serif** | SIL OFL 1.1 | Regular 400, Italic 400 | `h1`, section headlines (≥ 32 px), the verification verdict word |
| Body / UI | **Plus Jakarta Sans** | SIL OFL 1.1 | 400, 500, 600 | body, buttons, labels, inputs, navigation |
| Data | **JetBrains Mono** (unchanged) | SIL OFL 1.1 | as today | certificate numbers, serials, codes, OTP field |

- Loaded with **`next/font/local` from `.woff2` files committed to the repository** (Latin + Latin Extended subsets, which cover Indonesian), with the OFL text beside them. The existing faces use `next/font/google`, which downloads at **build** time, so an air-gapped build fails (research 05 §4). Either way the browser fetches fonts only from our own origin, so `font-src 'self'` (`frontend/src/lib/securityHeaders.ts`) holds. Only the public layouts attach the two new variables; the dashboard keeps Inter and Space Grotesk. JetBrains Mono is not preloaded on public pages (05 §7.2: it loads on every page today).
- Instrument Serif has only Regular and Italic. It is never used below 32 px, never for UI text, never bold (faux-bold is disabled with `font-synthesis: none`).
- Why Plus Jakarta Sans and not Inter for body: Inter stays the application face; Plus Jakarta Sans was designed in Indonesia for Jakarta's city identity (research 04 §5.1), which is a true local story, and it pairs with a high-contrast serif better than Inter. Its `I`/`l`/`1` are less distinct than a humanist face's, which is why every value a person transcribes stays in JetBrains Mono (07 § The Requirement That Shapes Everything, unchanged).
- Scale (public only; `clamp()` between 360 px and 1440 px): display-xl 44→88 px / 1.02, display-l 36→60 px / 1.05, display-m 28→40 px / 1.1, body-l 18→20 px / 1.6, body 16 px / 1.6, caption 14 px / 1.5. Letter-spacing −0.02 em on display sizes only.
- Numbers: `font-variant-numeric: tabular-nums` wherever figures align. Sentence case everywhere (07 § Case).
- Budget: display + body ≤ **90 KB** woff2 combined for the Latin subset; preload only the body 400 and display 400 files.

### 4.4 Space, radius, elevation

- 4 px base; sections 96–160 px apart on desktop, 64–96 px on mobile. Content max width 1200 px; prose measure 60–68 characters (07).
- Radius: 6 px controls, 12 px cards, 20 px the hero product frame. No pill buttons.
- Elevation by surface lightness, not shadow (08 § Dark Theme). One exception: the hero product frame carries a 1 px `--pub-border` and a soft accent glow capped at `--pub-glow`.
- Grain: an SVG `feTurbulence` noise at 3–4 % opacity over `--pub-bg`, generated in-house (no asset licence question). Applied as a CSS background image from a static file in `public/`, not an inline `<style>` (ADR-071 nonce CSP).

### 4.5 Motion

| Rule | Detail |
|---|---|
| Durations | the existing tokens `--dur-fast 220ms`, `--dur-base 480ms`, `--dur-slow 900ms` and `--ease-out-expo` (`globals.css`), which already drop to 0 under `prefers-reduced-motion: reduce` |
| Permitted | a fade-and-rise of 12 px on section entry, once; the motif's needle settling into the tolerance band once on hero load (≤ 1.2 s); the light behind the hero drifting ≤ 2 % over 20 s; hover and focus transitions |
| Forbidden | count-up numbers, parallax on text, magnetic or cursor-following elements, gradient text, auto-playing video, marquees, anything that loops without a pause control (WCAG 2.2.2), scroll-jacking, smooth-scroll libraries |
| Reduced motion | every animation's end state is rendered immediately; the ambient light is static. The static version is the design, not a fallback |
| Auth and verification | sign-in: only focus, hover and the step transition (≤ 220 ms). `/verify`: **zero motion** (14, unchanged) |
| Implementation | CSS transitions and one `IntersectionObserver` (the existing `ScrollReveal`). **No animation library on public pages:** GSAP (+ ScrollTrigger, SplitText), Lenis and Motion are removed from the landing and the auth pages (05 §7.1–7.2: three animation systems, ~305 KiB gzip JS on `/`; Motion on `/login` for a tab indicator). Remove `Marquee`, the `AuroraBackground`/`AnimatedBackground` blur stacks, `MagneticButton`, `TiltCard`, `Counter` and `animate-ping` from public pages |
| Text is never hidden for an entrance | no text is server-rendered at `opacity: 0` or behind a hydration-dependent entrance. Today the hero `<h1>` starts at opacity 0 and waits for ~305 KiB of JS, which ties LCP to hydration (05 §7.3). Entrances animate a decorative layer, or transition from an already-visible state |

---

## 5. Language: Indonesian Default, English Toggle

**The frontend has no i18n library** (checked 2026-09-29: none of `next-intl`, `i18next`, `react-intl` in `frontend/package.json` or `frontend/src`). The smallest approach that satisfies the nonce CSP (ADR-071) and the React Compiler lint:

1. **Dictionaries as typed modules**: `frontend/src/i18n/messages/id.ts` is the source of truth; `en.ts` is typed `Messages = typeof id`, so a key missing in English is a **compile error** (`npm run typecheck`). Flat, namespaced keys (`landing.hero.title`); strings may hold `{name}` placeholders filled by a 10-line `format()` helper. No ICU plural rules are needed on these pages (none of their strings count anything).
2. **Locale resolution on the server**: the root layout already reads request headers per request (ADR-071). It reads a `locale` cookie; absent or unknown → `id`. `<html lang>` is set from it (today it is hard-coded `"en"`). No `Accept-Language` sniffing: the owner chose Indonesian as the default for everyone.
3. **The toggle is a `<form>` posting to a Server Action** `setLocale(locale)` that sets the cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, one year) and re-renders; the server is the only reader, so no script needs it. It works without JavaScript, needs no inline script, and no client state. Labels are each language's own name: **"Bahasa Indonesia"**, **"English"**, never flags (research 02 §5.2).
4. **Server components read the dictionary directly**; the few client components (the login form, the request-access form) receive their strings as props or through one small `MessagesProvider`.
5. URLs do not change per language (no `/en/` prefix). SEO for English is a non-goal of this phase; `hreflang` is not emitted.
6. **Mixed-language parts** carry `lang` (SC 3.1.2): English standard names inside Indonesian copy ("ISO/IEC 17025", "21 CFR Part 11") need no markup (proper nouns), but an English sentence inside an Indonesian page does.
7. Back-end messages shown to the user (login errors, 429, 409) are **mapped by status and code on the client** to dictionary strings; raw backend English text is never shown on a public page.

**Rejected for now:** `next-intl` (research 02 §5.2's hint). It is the likely choice when the dashboard is translated in Phase 11, and the dictionary shape above (flat keys, `{name}` placeholders) migrates to it mechanically. Adding it now brings a dependency and a request-config layer for ~250 strings on six pages. ADR-098 §4.

---

## 6. Landing (`/`)

`frontend/src/app/page.tsx` is `"use client"` today, so the whole landing ships as client JavaScript. The revamp makes it a **server component** with client islands only where interaction needs them (language form works without JS; the verification field, the FAQ `<details>` need none). One `<main>`, one `<h1>` (ADR-090).

Order, top to bottom. Each section has one idea.

### 6.0 Header

Logo (the dark lockup) · anchors *Fitur · Alur kerja · Keamanan · Verifikasi · FAQ* · language form · **Masuk** (secondary) · **Hubungi kami** (primary, the accent). On < 1024 px the anchors collapse into a disclosure menu (a real `<button aria-expanded>`, focus trapped only while open, Escape closes). Sticky with a `--pub-bg` fill at 88 % and a hairline bottom border once scrolled; no blur-glass.

### 6.1 Hero

```
┌──────────────────────────────────────────────────────────────────────┐
│  [eyebrow] Kalibrasi · Sertifikat bertanda tangan · Multi-fasilitas  │
│                                                                      │
│  Setiap alat tercatat.                       ┌────────────────────┐  │
│  Setiap hasil terdokumentasi. (h1, serif)    │ real product UI:   │  │
│                                              │ calibration record │  │
│  sub-copy (2 lines, muted)                   │ + certificate with │  │
│                                              │ QR, "Contoh data"  │  │
│  [Hubungi via WhatsApp]  [Kirim email ke tim] └────────────────────┘  │
│  small: Masuk untuk pengguna terdaftar →   ░ precision scale motif ░ │
└──────────────────────────────────────────────────────────────────────┘
```

- **Visual:** a high-resolution screenshot (AVIF + WebP, `next/image`, `priority`) of the real calibration record and the signed certificate with its QR, from a seeded demo tenant with invented device data, over the precision-scale motif and one teal light. Watermark caption *Contoh data / Sample data*. **This image is the LCP element**; its budget is in §13.
- **Removed from today's hero** (P10-00): the "12,000+ instruments" pill and pulsing dot, `heroStats`, `HeroChips` ("99.2% on schedule", "Audit-ready"), the four randomuser.me faces, the "ISO 17025 · Traceable standards" eyebrow, the "Start free trial → /login" CTA (05 H1–H9). "Every result traceable" goes too: metrological traceability is a property of the laboratory's process, and `calibration_records.standard` is free text with no reference-standard chain behind it (05 H2–H3, `calibrationRecord.model.ts:121`).
- **CTAs:** primary **WhatsApp** (`https://wa.me/<number>?text=<prefilled, encoded>`), secondary **email** (`mailto:<address>`). Both come from configuration, not code: `NEXT_PUBLIC_CONTACT_WHATSAPP` and `NEXT_PUBLIC_CONTACT_EMAIL` (ADR-098 §8.8). **A channel whose value is empty is hidden, never shown as a placeholder.** The request-access link (*Minta akses untuk rumah sakit Anda →* `/request-access`) is always present, so the hero never ends up with no way forward.

### 6.2 The problem, in the hospital's words

One short band, no numbers: overdue devices found during a survey; certificates in binders; "who calibrated this, and against what?" asked with the surveyor in the room. Three short statements, serif, large. No statistics (there are none we can source).

### 6.3 Features and the workflow story

A horizontal story of six steps, each a real UI crop plus two lines. On desktop it is a sticky left column of step titles and a right column that swaps the crop as the reader scrolls (CSS `position: sticky` + `IntersectionObserver`; no scroll-jacking). On mobile and under reduced motion it is a plain vertical list.

| # | Step | Shows | Traceable to |
|---|---|---|---|
| 1 | **Alat** — import or add devices | device record: make, model, category, location, calibration interval | `backend/src/models/calibrationDevice.model.ts` (no owner and no risk-class field, 05 W3); CSV import `POST /calibration-devices/bulk-import` (`calibrationDevices.route.js:444`) |
| 2 | **Jadwal** — see what is due | the due/overdue list; work orders opened for due and overdue devices, the team notified | `backend/src/services/calibrationScheduler.service.js` (lines 7, 112–125); notification is tenant-wide and assignment manual (05 W4) |
| 3 | **Kalibrasi** — record results | result, reference standard, measurement uncertainty, and the compliant/non-compliant mark the technician enters | `backend/src/models/calibrationRecord.model.ts`; uncertainty budgets (migration `0009`); pass/fail is **entered, not computed** (05 W5); append-only in the database (migration `0057`, ADR-062) |
| 4 | **Sertifikat** — issue it | certificate in `draft → submitted → approved` | `backend/src/services/certificate.service.js`, `docs/API/08-CERTIFICATE-ESIGNATURE-API.md` |
| 5 | **Tanda tangan** — sign electronically, re-authenticating | the e-signature dialog | `backend/src/services/eSignature.service.js` (A-65 re-authentication) |
| 6 | **Verifikasi QR** — anyone can check it | the `/verify` verdict on a phone, with the SHA-256 integrity hash | `backend/src/routes/api/certificates.route.js:38`; `certificatePdf.service.js` (hash) |

Below the story, a compact grid of further capabilities stated as facts, no adjectives, each from 05 §3.14 and cited in §11: stock and warehouses with opname; maintenance work orders; each facility's data kept separate; an append-only audit trail; roles and approval workflows; CSV import and CSV report export; a REST API with API keys and webhooks; QMS (non-conformance, CAPA, SOPs, risk register).

**Never claimed** (no code behind them, 05 §1 item 2): barcode or QR **scanning** of devices, automatic pass/fail, technician auto-assignment, notifications to a device's owner, a traceable reference-standard chain, packaged KARS/SNARS evidence, multi-region data residency (`enable_data_residency` defaults to false), prebuilt CMMS/LIS connectors, a free trial (the tenant `status` ENUM has no trial state), end-to-end encryption, database-level tenant isolation, cross-region backups, DR drills, PagerDuty.

**Not shown:** "AI-powered", predictive maintenance, IoT, RAG, anything not on the calibration spine (14: "Do not enumerate all 33 modules").

### 6.4 Compliance and security — "supports", never a badge

Two columns of text, no logos, no chips, no ISO/KARS/KAN/ILAC marks.

- **Standards the records are built for** (verbs: *mendukung / supports*, *membantu menyiapkan / helps you prepare*): ISO/IEC 17025 (recording the reference standard and measurement uncertainty an assessor reviews; signed results); 21 CFR Part 11 (electronic signatures with re-authentication, audit trail); Indonesian hospital accreditation — worded as the working decision in ADR-098 §8.2 (awaiting owner confirmation): *mendukung persiapan akreditasi rumah sakit (standar akreditasi Kemenkes)* / *supports hospital accreditation readiness (Ministry of Health standards)*. **SNARS is not named**, and no regulation or decree number is cited; a legal review of the exact standard names is a pre-release item (§14). HIPAA and SOC 2 are **not mentioned at all** (the product holds no patient data: `docs/PLAN/00-PROJECT-OVERVIEW.md` § Non-Goals). ISO 13485 is not named on the page (no requirement-to-feature mapping exists).
- The section says plainly that Device Calibrator is not a certification body and is not itself certified; it helps prepare evidence (05 C14; `docs/PLAN/00-PROJECT-OVERVIEW.md`: "Callibrator does not issue accreditation. It produces evidence that an accredited body can audit.").
- **Security controls, each true today:** tenant isolation by default-deny scoping applied by the application to every model query (raw SQL carries the predicate by review, not by the hooks — so the copy never says "database-level" or "every query", 05 S4), a cross-tenant request answering *not found* (ADR-048, `backend/src/utils/tenantScope.util.ts`); MFA with an authenticator app (`auth.service.js` TOTP, A-99); SSO with SAML or OIDC (`sso.controller.js`); passkeys for signed-in users today, and passwordless passkey sign-in (counted as phishing-resistant MFA, ADR-098 §8.5) once P10-10 ships; sign-in throttling (`backend/src/constants/rateLimitConstants.ts`); every change audited with who, when and before/after values; the application role cannot update or delete audit rows (the `REVOKE UPDATE, DELETE` recorded in DECISIONS and cited by 05 §3.14, plus the trigger of migration `0091-audit-logs-append-only.ts`, Q-34). Never "complete": failed sign-ins write no audit row by decision (ADR-051 Q-15), 05 C6.
- One disclaimer line under the section: *Device Calibrator adalah perangkat lunak pencatatan dan alur kerja. Kalibrasi tetap dilakukan oleh laboratorium atau institusi penguji yang berwenang.* (The product does not perform calibration and does not replace an accredited provider — research 04 §4.1.)
- No operations claims (backups, replication, DR drills, TLS versions, "end-to-end encryption"): `SecuritySection.tsx`'s claims are unverified for the reference deployment (research 04 C16, Q11) and it stays unrendered.

### 6.5 Public certificate verification

A single field and a button: *Nomor sertifikat* → **Periksa**. Submitting navigates to `/verify/<number>` (a plain `<form method="get">` to a small route that redirects; works without JS). Beside it, a phone mock-up of a real verdict on the demo tenant's certificate. This is the most persuasive thing on the page (14 § Landing) and it is a working tool, not an illustration.

The field does not autocomplete from history (`autocomplete="off"`), accepts paste, trims whitespace, and does not reveal anything itself: the verdict is `/verify`'s job.

**A typed number gets the minimal verdict.** Certificate numbers are sequential (`CERT-YYYYMMDD-<tenant code>-NNNN`) and the verify endpoint returned device, serial and signer behind only the global limiter (A-293, research 05 §5.9). Working decision (ADR-098 §8.7, Q-47, awaiting owner confirmation): the QR carries a random verification token of at least 128 bits; a lookup **by number** returns only the minimal verdict (valid / revoked / expired, the issuing tenant, dates — no serial number, no signer name) under a per-IP rate limit. **A security agent is implementing that now; Phase 10 references it (P10-14) and does not re-plan it.** The field ships once that change is DONE; until then the section shows the phone mock-up and says that every certificate carries a QR code.

### 6.6 How we work with hospitals

Three steps as text: *Diskusi kebutuhan → Uji coba (pilot) → Penerapan dan pendampingan*. No durations and no promises until the owner states them.

### 6.7 FAQ

Native `<details>`/`<summary>` (keyboard and screen-reader accessible without script). Six questions, answers cited in §11: What is Device Calibrator? Does it perform calibration? Is our data separated from other hospitals? Can staff sign in with our hospital account (SSO)? Does it support Indonesian? How is the certificate checked by an auditor? **No pricing question** (no answer we can give).

### 6.8 Contact and footer

A final band repeating the two CTAs, then the footer: **only links that have a destination** (today every footer link except the product anchors is `href="#"`: Documentation, API Reference, Community, Contact, About, Careers, Partners, Privacy, Terms; 05 G6), *Kebijakan privasi* once the notice exists (release checklist §14), the language form, and `© {year} {legal entity}` (**Q-43**). No social links unless the owner supplies real accounts.

### 6.9 Removed from the landing

`TrustSection` (fictional hospital marquee, one of them the name of a real hospital network, and badge chips), `TestimonialsSection`, `PricingSection` (incl. "14-day free trial · No credit card"), `PlatformSection` (a Pexels "graph on laptop" photo presented as the product under an invented `app.hdc.health` URL, 05 P1), the "Audit prep: Days → minutes" card (05 C9), the patient-monitor photo (05 F9), `SecuritySection.tsx` (delete the file, 05 §3.11), the `accreditations`, `testimonials`, `partners`, `pricingTiers`, `heroStats` exports in `frontend/src/data/landing.ts`, the four `avatar-*.jpg` files, and the "Start free trial" link in `frontend/src/app/blog/[slug]/page.tsx`. P10-00 removes the fabricated items **before** any redesign.

---

## 7. Sign-in (`/login`)

### 7.1 Layout

Cinematic split-screen (owner brief). Left, ≥ 1024 px only: `--pub-bg` panel with the precision motif, the product glimpse, and one line of copy — **no claims** (today's `AuthBrandingPanel` says "HIPAA-ready access controls" and "ISO 17025-aligned workflows"; research 04 C13). Right: the form on `--pub-surface`, 400–440 px wide.

- **Exactly one `<h1>` at every width**, and it is in the **form**, not the panel: *Masuk ke Device Calibrator* (or *Masuk ke {tenantName}* on a tenant-pinned build). The panel's headline becomes a `<p>`. Today the `<h1>` moves between panel and form by breakpoint (`AuthBrandingPanel.tsx:65`, `login/page.tsx:77`).
- Top-left: *← Kembali ke beranda*. Top-right: the language form.
- A tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`, `useAuthBrand`, `GET /tenants/public`) shows the tenant logo above the `<h1>` and its name in it. No tenant colour (§4.1).

### 7.2 Identifier-first flow

Replaces the two tabs *Password Login / Enterprise SSO*.

```
Step 1  Email atau nama pengguna  [ ............ ]  (autocomplete="username webauthn")
        [Lanjutkan]
        ── atau ──
        [Masuk dengan kunci sandi (passkey)]        ← only after P10-10
        Masuk dengan SSO rumah sakit →              ← organisation-code fallback

Step 2a Kata sandi  [ ............ ] [tampilkan]    (autocomplete="current-password")
        Lupa kata sandi?                            → /forgot-password
        [Masuk]
Step 2b  → redirect to the hospital's identity provider (SAML or OIDC, decided by the server)
Step 3  Kode verifikasi (6 digit)  [ ...... ]       (MFA only; one field, paste allowed)
        Gunakan kode pemulihan                      (always visible)
```

**Discovery must not enumerate accounts.** The server decides step 2 **by the email's domain, not by the account**: a tenant whose SSO is enabled may have a list of email domains **set by the super admin** (a platform-controlled setting, because a tenant claiming `gmail.com` or a rival hospital's domain would hijack sign-in). The answer depends only on the domain, which is not a secret, so it reveals nothing about whether an account exists.

- New endpoint (P10-04 backend part): `POST /api/v1/auth/login/discover` `{ identifier }` → always `200` with `{ data: { next: "password" } }` or `{ data: { next: "sso", redirectUrl } }`. A username (no `@`) → always `password`. Rate-limited as a new `loginDiscover` entry in `API_ENDPOINTS` (per IP). No audit row (it reads nothing tenant-owned). Gate: public, recorded in the route file and in the two-tenant guard's allow-list only if it takes a path parameter (it does not).
- The SSO protocol (SAML vs OIDC) comes from the tenant's settings (`sso.controller.js` already resolves both by `tenantCode`); **the user is never asked for it**.
- The **residual**: the discover answer tells anyone that a given domain uses SSO on this platform, i.e. that the hospital is a customer. ADR-098 records it; it is the same fact a hospital-branded login link discloses. If the owner rejects that, the fallback is organisation-specific links only (`/login?org=<code>`), and discovery is dropped.
- **Fallback link** *Masuk dengan SSO rumah sakit*: asks for the organisation code only (no protocol), for tenants without a domain claim. It calls one new `POST /auth/sso/start` `{ orgCode }` that reads the tenant's configured protocol and answers **one generic refusal** for an unknown code, SSO disabled, or SSO misconfigured (*SSO tidak tersedia untuk kode organisasi ini* / *SSO is not available for this organisation code*), logging the real reason. Today `/sso/login` and `/sso/oidc/login` answer `404 Tenant not found` vs `400 SSO is not enabled…`, which lets anyone enumerate customer codes (A-292, research 05 §5.3), and neither had an auth pre-check limiter; ADR-100 puts the SSO start behind a request budget, so P10-04 adds no second limiter. The old routes stay for compatibility and get the same generic answer.
- `/login?org=<code>` (a tenant deep link) goes straight to that tenant's SSO when it is enabled, and otherwise shows the password step branded for it.

### 7.3 Form rules

| Rule | Detail |
|---|---|
| `autocomplete` (SC 1.3.5, failing today) | identifier `username webauthn` (the `webauthn` token only once P10-10 ships), password `current-password`, TOTP `one-time-code` (already set in `MfaLoginForm.tsx:79`) |
| Paste and password managers | never blocked (WCAG 2.2 SC 3.3.8) |
| Show password | a toggle button, `aria-pressed`, named *Tampilkan kata sandi* |
| Errors | field-level text, associated with `aria-describedby`, focus moves to the first error on submit, a `role="alert"` summary above the form |
| Submit | enabled until the request starts; then a busy state with `aria-busy` and text *Memeriksa…* |
| TOTP | one field, `inputmode="numeric"`, `maxlength` 6 but accepting a pasted code with spaces (stripped); the recovery-code switch is always visible; the instruction is tied to the input with `aria-describedby`; an expired MFA token says *Kode sudah kedaluwarsa, silakan masuk lagi* instead of the raw 401 (05 §5.2) |
| "Remember me" | **removed.** The checkbox in `PasswordLoginForm.tsx` has no state and sends nothing (05 A9): a control that lies. A longer session is a separate decision, not a checkbox |
| After sign-in | `/sso-callback` routes through the same `destinationAfterSignIn` as password sign-in (forced password change, MFA enrolment, `callbackUrl`); today it always pushes `/dashboard` (05 §5.1) |

### 7.4 Messages (14 § Failure states, kept)

| Backend answer | Shown (ID / EN) |
|---|---|
| 401 bad credentials (same for unknown and known accounts, A-185) | *Email/nama pengguna atau kata sandi salah.* / *Incorrect email/username or password.* |
| 429 from `authPreCheck` / the login throttle (carries `retryAfter` seconds) | *Terlalu banyak percobaan. Coba lagi dalam {minutes} menit.* / *Too many attempts. Try again in {minutes} minutes.* (minutes = `ceil(retryAfter/60)`) |
| Locked account (`users.locked_until`) | *Akun ini dikunci sementara. Coba lagi dalam {minutes} menit atau hubungi admin rumah sakit Anda.* |
| Suspended tenant (403 from the tenant check) | *Akun organisasi Anda sedang ditangguhkan. Hubungi admin rumah sakit Anda.* — not disguised as bad credentials (14) |
| MFA wrong code | *Kode verifikasi salah atau kedaluwarsa.* |
| Network / 5xx | *Tidak dapat terhubung. Periksa koneksi Anda lalu coba lagi.* |

### 7.4a First sign-in with a one-time password (P10-16, ADR-099)

Built by another agent; this section records it so the restyle keeps it intact. When the account holds a one-time password (the first super admin's bootstrap password, or one issued by `./backend rotate-bootstrap-password`), `POST /auth/login` answers `data.passwordChangeRequired: true` with a 10-minute *password-change* purpose token and **no session**; the Next login route passes it through as 202 without cookies, like the MFA step. The one-time password is spent by that use; a second use is the ordinary 401.

- Step *Buat kata sandi Anda* (`FirstPasswordChangeForm.tsx`, restyled, not redesigned): the password rule shown **before** typing; two `new-password` fields with show toggles; a mismatch announced; errors in `role="alert"`. Posts `{ token, newPassword }` to the public `POST /api/v1/auth/first-sign-in/password`.
- 200 → the client signs in again with the new password → the usual routing (an operator without MFA goes to enrolment). 401 → *Langkah ini sudah kedaluwarsa. Minta kata sandi sekali pakai yang baru kepada operator platform.* / *This step has expired. Ask the platform operator for a new one-time password.* — nothing about the account. 400 → the server's validation message, mapped through the dictionary.
- **Copy rule:** the plaintext bootstrap password exists only in `/app/.bootstrap/superadmin-password` inside the backend container. No string may suggest it arrives by email or is shown on screen.

Spec: `MEMORY/specs/P10-16-superadmin-bootstrap-otp.md`; card P10-16.

### 7.5 Passkey

The owner wants a passkey button, and a user-verifying passkey **counts as phishing-resistant MFA and skips the TOTP step** (ADR-098 §8.5). **The login page shows it only once P10-10 (passwordless WebAuthn authentication) is DONE.** Today every WebAuthn route sits behind `router.use(auth)` (`backend/src/routes/api/webauthn.route.js:13`), so `/webauthn/login-options` and `/webauthn/verify-login` need an existing session: there is no pre-authentication ceremony to call. Registration already requires a discoverable credential (`residentKey: "required"`, `webauthn.service.ts:126`), so passwordless sign-in needs a new endpoint pair, not a new enrolment. Spec: [`MEMORY/specs/P10-10-passkey-login.md`](../../MEMORY/specs/P10-10-passkey-login.md). When it ships: conditional UI (autofill) first via `autocomplete="username webauthn"` and `mediation: "conditional"`, the button second, lower-case "passkey" / *kunci sandi (passkey)* (FIDO guidance, research 04 §3.3). The button is rendered only when `window.PublicKeyCredential` exists.

---

## 8. Request Access (`/request-access`; `/register` redirects to it)

Replaces self-registration. `authService.registerUser` creates a **tenant-less** `USER` while the page promises a workspace (`auth.service.js:202`, `login/page.tsx:177` "Create a tenant workspace"), and its two 409s enumerate accounts. The page stops using `POST /auth/register`; the endpoint itself is **disabled in production behind a flag** and made neutral where enabled (working decision Q-44, A-290, P10-12). The header-built activation link (A-289) is being fixed under ADR-100 by a security agent; P10-12 verifies it.

Backend: [`MEMORY/specs/P10-05-request-access.md`](../../MEMORY/specs/P10-05-request-access.md).

### 8.1 Fields

| Field | ID label | Type / `autocomplete` | Required | Validation |
|---|---|---|---|---|
| Institution name | *Nama institusi* | text / `organization` | yes | 2–160 chars |
| Facility type | *Jenis fasilitas* | radio group: *Rumah sakit · Klinik · Laboratorium kalibrasi · Lainnya* | yes | enum |
| City | *Kota/kabupaten* | text / `address-level2` | yes | 2–80 |
| Number of devices (approx.) | *Perkiraan jumlah alat* | select: *< 100 · 100–499 · 500–1.999 · ≥ 2.000 · Belum tahu* | yes | enum |
| Contact name | *Nama lengkap* | text / `name` | yes | 2–120 |
| Role | *Jabatan* | text / `organization-title` | no | ≤ 80 |
| Work email | *Email kantor* | email / `email` | yes | RFC-valid, ≤ 254 |
| WhatsApp number | *Nomor WhatsApp* | tel / `tel` | yes | E.164 after normalising a leading `0` to `+62` |
| Needs | *Kebutuhan Anda* | textarea | no | ≤ 2,000 |
| Consent | checkbox, **not pre-ticked** | — | yes | must be true; the text names the purpose and links the privacy notice (UU 27/2022; research 04 §6.3) |
| Honeypot | a field named `website`, visually hidden off-screen, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"` on its wrapper, label *Jangan diisi* | — | — | must be empty |

### 8.2 Behaviour

- One column, labels above fields, helper text below, errors per field plus a summary (§7.3 rules).
- Submit → `POST /api/v1/access-requests`. The response is the **same neutral 202** whether the request is new, a duplicate, or caught by the honeypot (spec §API). A 400 (malformed field) shows field errors. A 429 shows the rate-limit message.
- **Success state** replaces the form (focus moves to its `<h1>`, `role="status"`): *Terima kasih. Permintaan Anda sudah kami terima. Tim kami akan menghubungi Anda.* No response time is promised (none has been committed). A link back to the landing.
- No email is sent to the requester at submit (the form must not be a way to make us email a stranger; spec §Security).
- **On approval** the requester receives an **invitation link** (single-use, time-limited purpose token) and sets their own password on `/invitation` (ADR-098 §8.4; P10-15). No temporary password is ever sent: the random one-time-password mechanism is only for the first super admin's bootstrap.
- **Retention** (ADR-098 §8.6): a rejected or expired request is kept 12 months, then purged by the existing retention job; an approved request keeps its link to the tenant it created. The privacy notice says so.
- **`/register`** redirects here, and the public `POST /auth/register` is **disabled in production** behind a flag (default off in production); where it is enabled, its 409s no longer enumerate (ADR-098 §8.3, A-290, P10-12).

---

## 9. Forgot and Reset Password (`/forgot-password`)

The backend flow is an **emailed 6-digit OTP**, not a link: `POST /auth/send-otp` then `POST /auth/reset-password` with `{ email, otp, password }` (`auth.service.js#requestOTP` line 678, `#resetPassword`; rate limits `forgotPassword` 3/15 min and `resetPassword` 5/5 min).

1. Step 1: *Email* (`autocomplete="email"`) → **Kirim kode**. Always answer *Jika email terdaftar, kami telah mengirim kode 6 digit. Kode berlaku 5 menit.*
2. Step 2: *Kode* (`one-time-code`), *Kata sandi baru* (`new-password`, show toggle), **Simpan kata sandi**. On success, go to `/login` with a `role="status"` notice.
3. Password helper text states the **rule the backend enforces** — P10-09 reads the reset-password schema in `backend/src/validators/` (the one `auth.service.js#resetPassword` validates against) and writes that rule, not a generic one.

**The answer is already neutral; the volume is not.** `requestOTP` returns different messages internally (lines 686 and 717), but the controller discards them and always sends *"If the account exists, OTP has been sent"* (`auth.controller.js:131–138`), so the endpoint does not enumerate (research 05 §5.6–5.7; an earlier draft of this section got that wrong by reading the service alone). P10-09 **pins** the neutral answer with a test that compares a known and an unknown address at the HTTP layer. What is open is **A-291**: successful OTP requests are never counted (`otpRequestCount` is incremented, not checked), so a known address can be sent codes repeatedly. ADR-100 (a security agent's change, in progress) adds request budgets that count successes too (`middlewares/requestBudget.middleware.ts`); P10-09 confirms the answer stays neutral when the budget trips and shows a resend cooldown from the 429's `Retry-After` (*Kirim ulang kode dalam {seconds} detik*).

---

## 10. Public Verification (`/verify/[certificateNumber]`)

Restyled in the public palette; **14 § The Verification Page stays in force word for word**: no login, verdict first at display size, the word carries the message, not-found and signature-mismatch identical, zero motion, not indexed, nothing consequential below the fold.

- The verdict card is `--pub-raised` with a 2 px border in the status colour; the verdict word is Instrument Serif at display-l, **with an icon and the word**, never colour alone. The accent never appears inside the card (§4.2).
- The verdict set is **what the page computes today** (`frontend/src/app/verify/[certificateNumber]/page.tsx:77–112`): valid · revoked · withdrawn · expired · not found · not yet valid. 08's four-verdict table is narrower than the code; ADR-098 amends 08 to list the six.
- Details in a two-column definition list, certificate number and serial in JetBrains Mono, dates in the medium format with the month as a word (07 § Dates).
- **Not indexed — a gap found while writing this spec:** `frontend/src/app/robots.ts` does not disallow `/verify`, and the page sets no `robots` metadata. P10-08 adds `robots: { index: false, follow: false }` metadata and an `X-Robots-Tag: noindex` header for `/verify/*`.
- The "Not yet valid" branch prints the internal status (`status: {data.status}`) for an unsigned certificate. P10-08 maps it to a label (05 V4). Whether an unsigned number answers anything at all on the typed-number path is part of the minimal-verdict change the security agent is making (ADR-098 §8.7); P10-08 follows it rather than deciding it.
- The verdict and the loading state are announced (`role="status"`, `aria-live="polite"`); today neither is in a live region (05 §5.8).
- "Valid" wording says what the page can know: *tercatat pada sistem penerbit, telah ditandatangani, dan masih berlaku* / *on the issuer's records, signed, and currently in force* — not "authentic", which the page cannot vouch for about the paper in hand (05 V3). The existing line *Pastikan nomor sertifikat sama dengan dokumen cetak* stays (05 V7).
- **Two views (ADR-098 §8.7):** reached through the QR token, the page shows the full verdict and fields; reached by a typed number, it shows the minimal verdict (valid / revoked / expired, issuing tenant, dates). The restyle designs both and adds no field to either.
- Language: the page follows the viewer's language for its chrome; **the certificate's own fields are shown as issued** (research 02 §5.2).

---

## 11. Copy Deck

Rules: every claim cites a code file or a `docs/` document; where research 05 supplied the rewrite, its row id is cited (05 classified every current string with evidence). The product name is **Device Calibrator** (working decision, ADR-098 §8.1, Q-43, awaiting owner confirmation); the code uses four names today ("Hospital Device Callibrator" in `<title>`, "HDC" in the nav and blog, "Device Calibrator" in the footer, auth default and logo SVG, "Callibrator" in the repository), and P10-03 makes every public string say Device Calibrator. Indonesian strings need a review by a native writer who knows IPSRS vocabulary, and nothing here is final until counsel review (§14).

### 11.1 Landing

| Key | Bahasa Indonesia (default) | English | Source for the claim |
|---|---|---|---|
| `landing.hero.eyebrow` | Mendukung alur kerja ISO/IEC 17025 · Multi-fasilitas | Supports ISO/IEC 17025 workflows · Multi-facility | 05 H2; tenant isolation (ADR-048) |
| `landing.hero.title` | Setiap alat tercatat. Setiap hasil terdokumentasi. | Every instrument on record. Every result documented. | 05 H3 ("traceable" dropped: 05 H2); `calibrationDevice.model.ts`, `calibrationRecord.model.ts` |
| `landing.hero.lead` | Jadwalkan kalibrasi, catat hasil beserta standar acuan dan ketidakpastian pengukurannya, lalu terbitkan sertifikat bertanda tangan elektronik yang keasliannya dapat diperiksa siapa pun lewat kode QR. | Schedule calibrations, record results with the reference standard and measurement uncertainty, and issue electronically signed certificates whose integrity anyone can check by QR code. | 05 H4; `calibrationScheduler.service.js`; `calibrationRecord.model.ts`; `eSignature.service.js`; `certificates.route.js:38` |
| `landing.hero.ctaWhatsapp` | Hubungi via WhatsApp | Chat on WhatsApp | `NEXT_PUBLIC_CONTACT_WHATSAPP`; hidden when empty (ADR-098 §8.8) |
| `landing.hero.ctaEmail` | Kirim email ke tim kami | Email our team | `NEXT_PUBLIC_CONTACT_EMAIL`; hidden when empty (ADR-098 §8.8) |
| `landing.hero.ctaRequest` | Minta akses untuk rumah sakit Anda | Request access for your hospital | P10-05 |
| `landing.hero.signin` | Sudah punya akun? Masuk | Already have an account? Sign in | `/login` |
| `landing.hero.sampleCaption` | Contoh data | Sample data | the screenshot is from a seeded demo tenant |
| `landing.problem.1` | Alat yang lewat jatuh tempo baru ketahuan saat survei. | Overdue devices discovered during the survey. | problem statement, not a claim |
| `landing.problem.2` | Sertifikat tersimpan di map, dicari satu per satu. | Certificates filed in binders, found one by one. | problem statement |
| `landing.problem.3` | "Siapa yang mengkalibrasi, dan dengan standar apa?" | "Who calibrated this, and against what?" | problem statement |
| `landing.flow.device` | Impor seluruh alat dari CSV atau tambahkan satu per satu — merek, model, lokasi, dan interval kalibrasi dalam satu catatan. | Import your devices from CSV or add them one by one — make, model, location and calibration interval on one record. | 05 W3; `calibrationDevice.model.ts`; `calibrationDevices.route.js:444` |
| `landing.flow.schedule` | Tetapkan interval per alat; sistem membuat perintah kerja untuk alat yang jatuh tempo atau terlambat dan memberi tahu tim Anda. | Set an interval per device; the system opens work orders for devices that are due or overdue and notifies your team. | 05 W4; `calibrationScheduler.service.js:7, 112–125` |
| `landing.flow.calibrate` | Teknisi mencatat hasil, standar acuan, dan ketidakpastian pengukuran, lalu menandai hasil sesuai atau tidak sesuai. Catatan kalibrasi tidak dapat diubah; koreksi dibuat sebagai catatan baru. | Technicians record results, the reference standard and measurement uncertainty, and mark the result compliant or non-compliant. Calibration records cannot be edited; a correction is a new record. | 05 W5; `calibrationRecord.model.ts` (`supersedesId`, `correctionReason`, `voidReason`); migration 0057; ADR-062 |
| `landing.flow.certificate` | Setujui hasil, tandatangani secara elektronik, dan terbitkan sertifikat dengan kode QR dan hash integritas yang dapat diverifikasi publik. | Approve, sign electronically, and issue a certificate carrying a QR code and an integrity hash anyone can verify. | 05 W6; `certificate.service.js`; `certificatePdf.service.js`; `docs/API/08-CERTIFICATE-ESIGNATURE-API.md` |
| `landing.flow.sign` | Tanda tangan elektronik dengan autentikasi ulang penandatangan. | Electronic signatures that re-authenticate the signer. | `eSignature.service.js` (A-65) |
| `landing.flow.verify` | Setiap sertifikat memiliki kode QR yang dapat diperiksa siapa saja, tanpa login. | Every certificate carries a QR code anyone can check, without signing in. | `certificates.route.js:38`; `/verify` page |
| `landing.caps.stock` | Gudang, stok, mutasi dan stok opname. | Warehouses, stock, transfers and stock opname. | `TASKS/PHASE-2-WAREHOUSE.md`; `stock.route.js`, `warehouse.route.js` |
| `landing.caps.maintenance` | Perintah kerja pemeliharaan. | Maintenance work orders. | `maintenance.route.js` |
| `landing.caps.multisite` | Setiap fasilitas terpisah datanya, dengan peran, pengguna, dan branding masing-masing. | Each facility's data kept separate, with its own roles, users and branding. | 05 F7; `utils/tenantScope.util.ts`; `tenantHierarchy.route.js`; ADR-084 |
| `landing.caps.reports` | Laporan kepatuhan, beban kerja, dan alat terlambat — dapat diekspor ke CSV. | Compliance, workload and overdue-device reports — exportable to CSV. | 05 F8; `reports.route.js:31–97`; `reporting.controller.js:6–11` |
| `landing.caps.api` | REST API dengan API key dan webhook untuk integrasi dengan sistem Anda. | A REST API with API keys and webhooks for integrating your own systems. | 05 P7; `apiKeys.route.js`, `webhooks.route.js` |
| `landing.caps.qms` | Ketidaksesuaian, CAPA, SOP, dan daftar risiko. | Non-conformances, CAPA, SOPs and a risk register. | 05 §3.14; `qms.route.js`, `sop.route.js`, `risk.route.js` |
| `landing.caps.audit` | Setiap perubahan tercatat di jejak audit dengan pelaku, waktu, dan nilai sebelum/sesudah. | Every change is recorded in the audit trail with who, when, and before/after values. | 05 C2; `audit.service.js`; `docs/DATABASE/10-AUDIT-LOGS.md` |
| `landing.caps.roles` | Hak akses berbasis peran dan alur persetujuan. | Role-based access and approval workflows. | 05 C7; `dynamicAccess.middleware.js`; `workflows.route.js` |
| `landing.caps.language` | Halaman publik tersedia dalam Bahasa Indonesia dan English. | Public pages available in Indonesian and English. | P10-02; **public pages only** — the dashboard is English until Phase 11, so the string says so |
| `landing.compliance.title` | Dirancang untuk catatan yang diperiksa auditor | Built for records an auditor inspects | — |
| `landing.compliance.iso17025` | ISO/IEC 17025 — mendukung pencatatan ketidakpastian dan standar acuan yang diperiksa asesor, serta hasil yang ditandatangani. | ISO/IEC 17025 — supports recording the uncertainty and reference standards assessors review, and signed results. | 05 C10; migration `0009`; `calibrationRecord.model.ts`; `eSignature.service.js` |
| `landing.compliance.part11` | Tanda tangan elektronik dan jejak audit yang dirancang untuk mendukung persyaratan 21 CFR Part 11. | Electronic signatures and audit trails designed to support 21 CFR Part 11 requirements. | `eSignature.service.js`; migration 0091; research 04 §4.1 |
| `landing.compliance.accreditation` | Mendukung persiapan akreditasi rumah sakit (standar akreditasi Kemenkes). | Supports hospital accreditation readiness (Ministry of Health standards). | ADR-098 §8.2 (Q-39); device calibration and maintenance history (`calibrationRecord.model.ts`, `maintenance.route.js`), 05 C11; exact standard names checked in the pre-release legal review |
| `landing.compliance.disclaimer` | Device Calibrator adalah perangkat lunak pencatatan dan alur kerja; kalibrasi tetap dilakukan oleh laboratorium atau institusi penguji yang berwenang. Device Calibrator bukan lembaga sertifikasi dan tidak bersertifikat atas standar-standar ini; platform ini membantu Anda menyiapkan bukti. | Device Calibrator is record-keeping and workflow software; calibration is performed by an authorised laboratory or testing institution. Device Calibrator is not a certification body and is not itself certified against these standards; it helps you prepare the evidence. | research 04 §4.1; 05 C14; `docs/PLAN/00-PROJECT-OVERVIEW.md` § Non-Goals |
| `landing.security.isolation` | Data setiap rumah sakit dipisahkan secara default; permintaan ke data tenant lain dijawab "tidak ditemukan". | Each hospital's data is separated by default; a request for another tenant's data answers "not found". | 05 §3.14; `utils/tenantScope.util.ts`; ADR-048; `twoTenantRoutes.guard.test.ts` (201 `:id` routes accounted for) |
| `landing.security.mfa` | Autentikasi dua faktor dengan aplikasi autentikator. | Two-factor authentication with an authenticator app. | `auth.service.js` (TOTP, A-99) |
| `landing.security.sso` | Masuk dengan akun rumah sakit melalui SSO (SAML atau OIDC). | Sign in with your hospital account through SSO (SAML or OIDC). | `sso.controller.js` |
| `landing.security.passkey` | Kunci sandi (passkey) untuk pengguna yang sudah masuk; masuk tanpa kata sandi menyusul. | Passkeys for signed-in users; passwordless sign-in to follow. | `webauthn.route.js`; **rewrite when P10-10 ships** |
| `landing.security.throttle` | Pembatasan percobaan masuk untuk menahan penebakan kata sandi. | Sign-in throttling against password guessing. | `constants/rateLimitConstants.ts` (A-185) |
| `landing.security.auditRows` | Jejak audit append-only: tidak dapat diubah atau dihapus oleh aplikasi. | Append-only audit trail: the application cannot edit or delete it. | 05 C6; `REVOKE UPDATE, DELETE` (DECISIONS, cited by 05 §3.14) and migration `0091-audit-logs-append-only.ts`; **P10-03 confirms both hold on the reference deployment, as the application role, before this string ships** |
| `landing.verify.title` | Periksa keaslian sertifikat | Check a certificate | — |
| `landing.verify.label` | Nomor sertifikat | Certificate number | — |
| `landing.verify.button` | Periksa | Check | — |
| `landing.verify.lead` | Setiap sertifikat memiliki kode QR. Auditor memindainya dengan ponsel dan langsung melihat status sertifikat pada sistem penerbit. | Every certificate carries a QR code. An auditor scans it with a phone and sees the certificate's status on the issuer's records. | `frontend/src/lib/certificatePdf.ts` (QR of `verifyUrl`, footer); `certificates.route.js:38`; `/verify` page. Added in P10-03 (record 2026-09-30-P10-03-landing) |
| `landing.verify.help` | Nomor sertifikat tercetak di bagian atas sertifikat. | The certificate number is printed at the top of the certificate. | `frontend/src/lib/certificatePdf.ts:258` (the number, top block; the QR is in the footer). **Checked in P10-03**: the earlier "next to the QR code" was not what the PDF prints (M-11 moved rendering to the frontend) |
| `landing.work.title` | Cara kami bekerja dengan rumah sakit | How we work with hospitals | — |
| `landing.work.steps` | Diskusi kebutuhan · Uji coba · Penerapan dan pendampingan | Discuss your needs · Pilot · Rollout and support | describes the sales process, not a product claim; no durations promised |
| `landing.faq.*` | six Q&As, §6.7; each answer reuses a string above | — | as above |
| `pub.footer.privacy` | Kebijakan Privasi | Privacy Notice | shown only while `PRIVACY_NOTICE_URL` is set (ADR-113); the notice itself is a go-live prerequisite (§14) |

### 11.2 Sign-in, request access, reset, verify

| Key | Bahasa Indonesia | English |
|---|---|---|
| `auth.back` | ← Kembali ke beranda | ← Back to home |
| `auth.login.title` | Masuk ke Device Calibrator | Sign in to Device Calibrator |
| `auth.login.titleTenant` | Masuk ke {tenantName} | Sign in to {tenantName} |
| `auth.login.identifier` | Email atau nama pengguna | Email or username |
| `auth.login.continue` | Lanjutkan | Continue |
| `auth.login.password` | Kata sandi | Password |
| `auth.login.showPassword` | Tampilkan kata sandi | Show password |
| `auth.login.forgot` | Lupa kata sandi? | Forgot password? |
| `auth.login.submit` | Masuk | Sign in |
| `auth.login.busy` | Memeriksa… | Checking… |
| `auth.login.ssoFallback` | Masuk dengan SSO rumah sakit | Sign in with hospital SSO |
| `auth.login.orgCode` | Kode organisasi | Organisation code |
| `auth.login.passkey` | Masuk dengan kunci sandi (passkey) | Sign in with a passkey |
| `auth.login.noAccount` | Belum punya akses? Minta akses | No access yet? Request access |
| `auth.firstPassword.title` | Buat kata sandi Anda | Choose your password |
| `auth.firstPassword.confirm` | Ulangi kata sandi baru | Repeat the new password |
| `auth.firstPassword.mismatch` | Kedua kata sandi tidak sama. | The two passwords do not match. |
| `auth.firstPassword.expired` | Langkah ini sudah kedaluwarsa. Minta kata sandi sekali pakai yang baru kepada operator platform. | This step has expired. Ask the platform operator for a new one-time password. |
| `auth.mfa.title` | Kode verifikasi | Verification code |
| `auth.mfa.help` | Masukkan 6 digit dari aplikasi autentikator Anda. | Enter the 6 digits from your authenticator app. |
| `auth.mfa.recovery` | Gunakan kode pemulihan | Use a recovery code |
| `auth.error.credentials` | Email/nama pengguna atau kata sandi salah. | Incorrect email/username or password. |
| `auth.error.rateLimited` | Terlalu banyak percobaan. Coba lagi dalam {minutes} menit. | Too many attempts. Try again in {minutes} minutes. |
| `auth.error.locked` | Akun ini dikunci sementara. Coba lagi dalam {minutes} menit atau hubungi admin rumah sakit Anda. | This account is temporarily locked. Try again in {minutes} minutes or contact your hospital administrator. |
| `auth.error.suspended` | Akun organisasi Anda sedang ditangguhkan. Hubungi admin rumah sakit Anda. | Your organisation's account is suspended. Contact your hospital administrator. |
| `auth.error.mfa` | Kode verifikasi salah atau kedaluwarsa. | The verification code is wrong or has expired. |
| `auth.error.network` | Tidak dapat terhubung. Periksa koneksi Anda lalu coba lagi. | Could not connect. Check your connection and try again. |
| `access.title` | Minta akses untuk institusi Anda | Request access for your institution |
| `access.lead` | Ceritakan sedikit tentang fasilitas Anda. Tim kami akan menghubungi Anda untuk menjadwalkan diskusi. | Tell us a little about your facility. Our team will contact you to arrange a conversation. |
| `access.consent.before` + `.notice` + `.after` | Saya setuju data di formulir ini digunakan untuk menghubungi saya terkait permintaan akses ini dan disimpan sesuai [Kebijakan Privasi]. | I agree that the data in this form may be used to contact me about this access request and kept as described in the [Privacy Notice]. |
| `access.closed.title` / `.lead` / `.leadNoChannels` | Permintaan akses belum dibuka · Permintaan akses publik belum dibuka. Untuk berbicara dengan kami sekarang, gunakan salah satu saluran di bawah ini. · … Silakan kembali lagi nanti. | Requests are not open yet · Public access requests are not open yet. To talk to us now, use one of the channels below. · … Please check back later. |
| `access.submit` | Kirim permintaan | Send request |
| `access.success.title` | Terima kasih, permintaan Anda sudah kami terima. | Thank you — we have received your request. |
| `access.success.body` | Tim kami akan menghubungi Anda. | Our team will contact you. |
| `invite.title` | Buat kata sandi Anda | Set your password |
| `invite.lead` | Undangan ini untuk {email}. Buat kata sandi untuk mengaktifkan akun administrator {tenantName}. | This invitation is for {email}. Set a password to activate the {tenantName} administrator account. |
| `invite.expired` | Tautan undangan ini sudah tidak berlaku. Hubungi tim kami untuk undangan baru. | This invitation link is no longer valid. Contact our team for a new one. |
| `reset.title` | Atur ulang kata sandi | Reset your password |
| `reset.resend` | Kirim ulang kode dalam {seconds} detik | Resend the code in {seconds} seconds |
| `reset.sent` | Jika email terdaftar, kami telah mengirim kode 6 digit. Kode berlaku 5 menit. | If the email is registered, we have sent a 6-digit code. It is valid for 5 minutes. |
| `reset.newPassword` | Kata sandi baru | New password |
| `reset.done` | Kata sandi diperbarui. Silakan masuk. | Password updated. Please sign in. |
| `verify.valid` | SAH | VALID |
| `verify.expired` | KEDALUWARSA | EXPIRED |
| `verify.revoked` | DICABUT | REVOKED |
| `verify.withdrawn` | DITARIK | WITHDRAWN |
| `verify.notFound` | TIDAK DITEMUKAN | NOT FOUND |
| `verify.notYetValid` | BELUM BERLAKU | NOT YET VALID |
| `verify.validLead` | Sertifikat ini tercatat pada sistem penerbit, telah ditandatangani, dan masih berlaku. | This certificate is on the issuer's records, signed, and currently in force. |
| `verify.crossCheck` | Pastikan nomor sertifikat sama dengan dokumen cetak. | Check that the certificate number matches the printed document. |
| `verify.minimalNote` | Pemeriksaan dengan nomor menampilkan ringkasan. Pindai kode QR pada sertifikat untuk rincian lengkap. | A lookup by number shows a summary. Scan the QR code on the certificate for the full details. |

Sources for the auth strings: `backend/src/routes/api/auth.route.js`, `auth.service.js` (OTP 5-minute expiry, line 693), `rateLimiter.redis.service.js#authPreCheck` (`retryAfter`), 14 § Failure states.

---

## 12. Asset Register

Every asset shipped on a public surface is listed here with its source and licence before it merges (P10-11 checks that each file under `frontend/public/marketing/` and `frontend/public/brand/` has a row). **Free for commercial use only** (owner brief).

| Asset | Source | Licence | Notes |
|---|---|---|---|
| Instrument Serif (display) | https://github.com/Instrument/instrument-serif — file `frontend/src/app/fonts/instrument-serif-latin-400-normal.woff2` from the @fontsource/instrument-serif build (jsDelivr), loaded with `next/font/local` (P10-01) | SIL OFL 1.1 | `frontend/public/licenses/OFL-InstrumentSerif.txt`; Regular only — the Italic is not used and not shipped |
| Plus Jakarta Sans (body) | https://github.com/tokotype/PlusJakartaSans — files `frontend/src/app/fonts/plus-jakarta-sans-latin-{400,500,600}-normal.woff2` from the @fontsource/plus-jakarta-sans build | SIL OFL 1.1 | `frontend/public/licenses/OFL-PlusJakartaSans.txt`. Latin subset only (Indonesian needs nothing beyond Basic Latin); four files 57.4 KB total, under the 90 KB budget |
| JetBrains Mono (data) | https://github.com/JetBrains/JetBrainsMono | SIL OFL 1.1 | already bundled |
| Lucide icons | https://lucide.dev/license | ISC (some MIT from Feather) | already a dependency (`lucide-react`); stroke 1.5 on public surfaces |
| Brand mark and lockups | `frontend/public/brand/` (08 § The Product's Own Brand) | presumed owned — **no origin or licence record exists** (05 §4) | use the dark variants; record the designer and date; the SVG `<title>` reads "Device Calibrator" until Q-43 |
| Precision-scale motif (SVG) | drawn in-house for P10-01 | owned | graduation ticks, tolerance band, needle; tokens only |
| Grain texture `frontend/public/textures/grain.svg` | generated in-house (`feTurbulence`) | owned | static file, applied as a CSS background (no inline `<style>`) |
| Hero and workflow screenshots — `frontend/public/marketing/product/`: `hero.webp`, `step-device.webp`, `step-schedule.webp`, `step-calibrate.webp`, `step-certificate.webp`, `step-sign.webp`, `step-verify.webp` | captured 2026-09-30 (P10-03) with puppeteer at 2× from the product's own dashboard (dark theme) and `/verify`, on a disposable local stack seeded by `GET /migration/seed-demo` plus seven invented devices (`CONTOH-*` serials, makers "Contoh Medika", "Alat Sehat", "Nusantara Instrumen"); sidebar and top bar cropped out; WebP q80 via sharp | owned | no real hospital, patient or staff names (demo users only: "Demo Healtcare Admin", "Super System"); captioned "Contoh data / Sample data" wherever shown; re-capture on the release build (§14) |
| `frontend/public/marketing/CREDITS.md` | this register's human-readable companion | — | lists what P10-00 removed |
| Photographs | **none planned.** If one is added: Unsplash (https://unsplash.com/license) or Pexels (https://www.pexels.com/license/), no identifiable people or branded equipment, and a model/property release question answered first (research 04 §5.3) | per source | the nine Pexels files in `public/marketing/` are removed with the sections that used them |
| `avatar-1.jpg` … `avatar-4.jpg` | randomuser.me (`portraits/men/32, women/44, men/76, women/68`) | **no model release for advertising**; real faces attached to invented names and ratings | **deleted in P10-00** |
| `platform-dashboard.jpg`, `feature-monitoring.jpg` | Pexels | Pexels License | **deleted in P10-00**: the first is presented as the product, the second shows a patient monitor for a product that holds no patient data (05 P1, F9) |
| the other seven Pexels photos (`step-*.jpg`, `compliance-audit.jpg`, `cta-band.jpg`, `hero-clinician.jpg`) | Pexels | Pexels License | **deleted in P10-03** with the sections that used them |
| `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | Next.js starter | MIT | unused — delete (P10-00) |
| `gsap` (+ ScrollTrigger, SplitText), `lenis`, `motion` | npm | GSAP "Standard no-charge" licence (not OSI); Lenis and Motion MIT | removed from public pages (§4.5); if GSAP stays anywhere in the app, its licence is recorded here |
| `jspdf` (verify page, lazy) | npm | MIT | kept |
| Noto Sans Regular + Bold, subset (`public/fonts/NotoSans-{Regular,Bold}-LGC.ttf`, certificate PDF only) | https://github.com/notofonts/notofonts.github.io/tree/main/fonts/NotoSans/unhinted/ttf (Noto Sans 2.015), subset with fontTools to Latin, Latin Extended A/B/Additional, IPA, combining marks, Greek, Cyrillic, punctuation, currency, letterlike, number forms, arrows, math operators | SIL OFL 1.1 (no Reserved Font Name) | OFL text `frontend/public/licenses/OFL-NotoSans.txt`; fetched only when a certificate PDF is rendered, never by a page (ADR-095 follow-up O-5) |
| Inter, Space Grotesk | `next/font/google` (dashboard) | SIL OFL 1.1 | unchanged; not loaded by the public layouts |

---

## 13. Acceptance Criteria

Measured on a production build (`next build` + `next start`), not the dev server. Each is a checkbox in P10-13.

| # | Criterion | How it is measured |
|---|---|---|
| AC-1 | **axe-core: 0 violations** on `/`, `/login` (each step, incl. MFA and the first-sign-in password step), `/request-access` (empty, error, success), `/forgot-password` (both steps), `/verify/<valid>`, `/verify/<not-found>` | `@axe-core/puppeteer` or the existing browser smoke harness (ADR-077), WCAG 2.1 A/AA tags |
| AC-2 | Exactly one `<main>` and one `<h1>` per page, at 360 px and 1440 px | DOM query in the same run |
| AC-3 | Keyboard: every control reachable in visual order, visible focus (the accent ring, ≥ 3:1), no trap; the header menu closes on Escape; the FAQ opens with Enter/Space | scripted Tab walk + manual check recorded |
| AC-4 | Layout holds from **320 px to 1920 px**: no horizontal scroll (SC 1.4.10), no clipped text, text zoom 200 % | screenshots at 320, 375, 768, 1024, 1440, 1920 |
| AC-5 | Lighthouse (mobile, simulated throttling) on `/`: Performance ≥ **90**, Accessibility **100**, Best Practices ≥ 95, SEO ≥ 95. On `/login` and `/verify/*`: Performance ≥ **95** | Lighthouse CLI, three runs, median |
| AC-6 | **LCP ≤ 2.5 s** (mobile, Moto G Power profile) on `/`; ≤ 1.8 s on `/login` and `/verify/*`. CLS ≤ 0.05. INP ≤ 200 ms | Lighthouse + one WebPageTest run |
| AC-7 | Weight: `/` ≤ **180 KB** JavaScript (compressed, first load) and hero image ≤ **160 KB** AVIF at 1440 w; `/verify/*` ≤ 120 KB JS. *Compressed* = **brotli**, per file; *first load* = the root main files plus every chunk the route's client-reference manifest lists (ADR-098 Amendment 2: `next build` 16 prints no sizes, and the framework alone is 127 KB gzip, so a gzip 120 KB is unreachable with React 19) | `frontend/scripts/bundle-budget.mjs` after `next build` (in CI; ceilings in `frontend/bundle-budget.json`, gzip ceilings too) + DevTools for the image |
| AC-8 | `prefers-reduced-motion: reduce`: no element moves; every section complete | emulated in the browser run |
| AC-9 | CSP: zero violation reports; no request to any third-party origin (fonts, images, analytics) | DevTools network + `report-to` log |
| AC-10 | Both languages: every page renders with no missing key (typecheck) and no English leaking into the Indonesian page | typecheck + a string-scan test |
| AC-11 | Copy-truthfulness guard (P10-11) green | Jest |
| AC-12 | Live E2E: sign-in (password, MFA, one-time password → choose password), identifier-first SSO redirect, request-access submit → queue → approve, forgot/reset, verify valid/not-found | new specs in the live suite; the whole suite green in one run (ADR-077 standard) |

## 14. Release Checklist (before the public pages go live)

*Walked 2026-10-01 for P10-13 (record `MEMORY/records/2026-10-01-p10-13-sso-a11y-ci.md`): an item is ticked only with evidence cited beside it; human-only, owner-only and release-time items stay open.*

- [ ] **Legal (counsel) review of every string in §11**, in both languages, including the exact accreditation-standard names (ADR-098 §8.2) — claims, the compliance section, the disclaimer, the consent text and the privacy notice (UU 8/1999, UU 27/2022, Etika Pariwara Indonesia; research 04 §4.1 is not legal advice). **Q-42.** *OPEN — human-only (counsel).*
- [ ] A privacy notice exists (data controller named, the 12-month request retention stated) and is linked from the footer and the consent checkbox. **Q-42.** *Reviewed 2026-10-01: OPEN — no privacy page exists in `frontend/src/app`; the notice text needs the owner's data controller and counsel. **Made safe 2026-10-01 (ADR-113):** the form does not open until `PRIVACY_NOTICE_URL` names the published notice — unset, `/request-access` shows "not open yet" plus the contact channels, `POST /access-requests` is the absent-route 404, and the footer has no privacy link; set, the consent links to it and the footer shows Kebijakan Privasi / Privacy Notice. Go-live step: publish the notice, then set the variable (deploy/README.md).*
- [ ] `NEXT_PUBLIC_CONTACT_WHATSAPP` / `NEXT_PUBLIC_CONTACT_EMAIL` configured on the deployment, and someone answers them (research 04 Q8). An empty one is hidden, never a placeholder. **Q-41.** *Reviewed 2026-10-01: the code half holds (`components/public/contact.ts`: an empty or blank value is hidden); the values and someone to answer them are the owner's — OPEN (owner, at deploy).*
- [x] No regulation or decree number is cited in the copy (**Q-40**), and the accreditation line is the working-decision wording (**Q-39**). *Evidence 2026-10-01: `landing.compliance.accreditation` is the ADR-098 §8.2 wording in both dictionaries; the copy-truthfulness guard (`frontend/src/tests/public/copyTruthfulness.p1011.test.ts`, 60/60) now bans Permenkes/Kepmenkes/UU/PP/"Nomor … Tahun …" citations (`copyRules.ts`) besides SNARS/KARS. Q-39/Q-40 still await the owner's confirmation and the legal review (MEMORY/records/2026-10-01-p10-13-sso-a11y-ci.md).*
- [ ] "Device Calibrator" (**Q-43**) applied to `<title>`, header, footer, the auth default and the blog metadata; the legal entity for the copyright line supplied by the owner (until then the line reads `© {year} Device Calibrator`). *Reviewed 2026-10-01: the name half holds (`app/layout.tsx` title, `BrandLockup`, `pub.footer.copyright`, `useAuthBrand` default, `content.blog/news.meta.title`); the legal entity is the owner's — OPEN. Outside this item's public scope, "HDC" / "Hospital Device Callibrator" remain in the dashboard sidebar, `constants/index.ts` APP_NAME (unused) and an unreachable branding fallback (MEMORY/records/2026-10-01-p10-13-sso-a11y-ci.md).*
- [x] The certificate-token and minimal-verdict change (**Q-47**, the security agent's work tracked as P10-14) DONE before the landing's lookup field ships. *Evidence: A-293 (ADR-100 §1); live in P10-13 runs G and H — `p10-verify-passkey.e2e.test.ts` (token → full verdict, number → minimal, budget 60/61st 429) and the browser check *verify* (`MEMORY/records/2026-09-30-p10-13-e2e.md`). P10-14 stays IN REVIEW for the commit and the owner's confirmation of Q-47.*
- [ ] Screenshots re-captured from the demo tenant on the release build. *OPEN — release-time (needs the release build).*
- [ ] P10-13 acceptance run recorded with named tests. *Partly: AC-1/2/8/9/10/11/12 have named runs (`2026-09-30-p10-13-e2e.md`, MEMORY/records/2026-10-01-p10-13-sso-a11y-ci.md); AC-3 (keyboard) and the NVDA walk are human-only; AC-5/AC-6 (Lighthouse/LCP) are VM-only (a quiet host or the VM); AC-4 **met 2026-10-01**: all ten public page states at 320/375/768/1024/1280/1440/1920, 200 % zoom and 200 % text-only zoom — 90 captures in `research/screens/ac4-*`; 0 sideways scroll, 0 clipped and 0 overlapping text, one `<main>`/`<h1>` and `lang` on every one, checked by `automate/responsive.browser.js` (in `make test-browser`; `RESPONSIVE_SELFTEST=1` shows it fails on a planted defect); MEMORY/records/2026-10-01-p10-a341-q43-privacy-ac4.md §5; the valid (SAH) and expired verification pages added 2026-10-02 at every width, `ac4-verify-valid-*` / `ac4-verify-expired-*`, MEMORY/records/2026-10-02-p10-live-pair-ij.md.*

## 15. Owner Questions — working decisions awaiting confirmation

The coordinating session set a working answer for each of these on 2026-09-29 (it reported the owner had delegated them). Implementation proceeds on them; each is a row in [`TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) marked **awaiting owner confirmation**, and a numbered item in ADR-098 §8. The owner may overturn any of them.

| # | Question | Working decision |
|---|---|---|
| **Q-39** | Which accreditation standard does the copy name? | None by name: *Mendukung persiapan akreditasi rumah sakit (standar akreditasi Kemenkes)* / *supports hospital accreditation readiness (Ministry of Health standards)*; never SNARS; exact names checked in the pre-release legal review |
| **Q-40** | Which regulation governs periodic calibration (Permenkes 54/2015 is listed as no longer in force)? | Follows Q-39: the copy cites no regulation or decree number; the legal review confirms |
| **Q-41** | WhatsApp number and sales email | Configuration values `NEXT_PUBLIC_CONTACT_WHATSAPP`, `NEXT_PUBLIC_CONTACT_EMAIL`; an empty channel is hidden, never a placeholder; no response time promised. The values themselves still come from the owner |
| **Q-42** | Legal review, privacy notice, consent, request retention | Legal review before release; the privacy notice exists before `/request-access` goes live; rejected or expired requests kept 12 months then purged by the existing retention job; an approved request keeps its tenant link |
| **Q-43** | Product name | **Device Calibrator** on every public surface (matches the logo and `APP_NAME`'s default); "Callibrator" is the codename only; "HDC" is not used. The legal entity for the copyright line still comes from the owner |
| **Q-44** | The public `POST /auth/register` | Disabled in production behind a flag (default off in production); its 409s made neutral where it is enabled |
| **Q-45** | First administrator on approval | An invitation link (single-use, time-limited purpose token that sets the password); no temporary password — the random one-time password is for the super-admin bootstrap only |
| **Q-46** | Does a passkey count as MFA? | Yes: a user-verifying passkey (UV required) is phishing-resistant MFA and skips the TOTP step, including for platform operators (ADR-059 amended when P10-10 lands) |
| **Q-47** | Certificate enumeration | A random verification token of at least 128 bits in the QR/verify link; a lookup by number returns only a minimal verdict (valid/revoked/expired, issuing tenant, dates; no serial, no signer) under a per-IP rate limit. Reported as being implemented by a security agent; Phase 10 references it (P10-14) and does not re-plan it |

Also set by default in ADR-098 and open for the owner to overturn: the email-domain SSO discovery residual (§7.2); blog and news keep their 19 Part II design but take the new public header and footer; a pending access request nobody decides expires after 90 days.

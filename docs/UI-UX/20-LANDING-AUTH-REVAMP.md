# 20 — Landing, Sign-in, Request Access and Verification Revamp (Phase 10)

**Written:** 2026-09-29 · **Status:** design spec for [`TASKS/PHASE-10-LANDING-AUTH-REVAMP.md`](../../TASKS/PHASE-10-LANDING-AUTH-REVAMP.md). Nothing here is built yet. · **Decision record:** ADR-098 in [`MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md).

**Binding input:** the owner's answers in [`research/00-owner-brief-landing-auth.md`](research/00-owner-brief-landing-auth.md), and the **working decisions set by the coordinating session** on 2026-09-29 for the follow-up questions (product name, accreditation wording, the register endpoint, invitations, passkeys as MFA, request retention, certificate enumeration, contact channels, no pricing and no trial). The coordinating session reported that the owner delegated these to it; that delegation is not recorded first-hand anywhere in the repository, so each is written in ADR-098 §8 and in [`TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) (Q-39 … Q-47) as a **working decision awaiting the owner's confirmation**. Work proceeds on them; the owner can overturn any. Where the research recommends otherwise, the owner's answer stands and the research view is recorded in ADR-098 as the rejected alternative.

**Amended 2026-10-05 — ADR-118 (P10-17, the warm redesign):** the owner replaced the dark-cinematic direction with a **warm, light** public surface (ivory, cream, charcoal, one copper accent, dark teal only as the "verified" marker) and allowed **licensed editorial photographs** captioned as illustrations. §3, §4.1, §4.2, §4.3, §4.5, §6, §11.1 and §12 say what changed; where an older sentence below still says "dark", "near-black" or "teal accent", ADR-118 wins.

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

1. **Warm and human, not theatrical** (ADR-118). Ivory and charcoal, large serif type, people at work, slow light. No gradient text, no magnetic buttons, no pulsing "live" dots, no marquee (research 04 §2.3); a count-up only on a figure inside a mock-up labelled *Contoh data*. *(Was: "Cinematic. Dark …", 2026-09-29.)*
2. **People and the product, together.** Real UI rendered crisply, labelled *Contoh data / Sample data*, placed in the scene beside a licensed photograph of someone at work. A photograph is captioned *Foto ilustrasi / Illustrative photo*; nobody in it is presented as a customer, our staff or a quote's speaker (ADR-118 §2). *(Was: "Never a stock clinician".)*
3. **One motif, owned.** A precision scale: graduation ticks, a tolerance band, a needle settling inside it. Drawn in SVG in-house (§12).
4. **Every claim has a source.** If §11 cannot cite a file or a document for a sentence, the sentence does not ship. P10-11 makes this a test.
5. **One accent.** Copper `#9A4E22` (ADR-118); a soft gold for decoration only; dark teal `#0E5A52` means "verified" and nothing else. Status colours appear only where they carry a status (the verification verdict, form errors). The brand mark keeps its own teal inside the logo.
6. **Motion explains or it goes.** Every animation has a static equivalent that is complete, not degraded.

---

## 4. Tokens

### 4.1 Scope

The public palette is a **separate token set** applied by a `data-surface="public"` attribute on the public layouts (landing, `/login`, `/request-access`, `/forgot-password`, `/verify/*`, `/activation`). The dashboard tokens in `frontend/src/app/globals.css` (ADR-090) are **not changed**. The public surfaces are **light by default** since ADR-118 (2026-10-05: ivory, charcoal, copper). Since **Amendment 3** they also have a **warm dark mode**: it follows the app's `.dark` class and stored choice (`hdc-theme-preference`, shared with the dashboard), or `prefers-color-scheme` when nothing is stored. The toggle is in the public header, the mobile menu and the auth shell. One set serves every public page — landing, sign-in, request access, reset, invitation, activation, verification, blog and news — so a visitor never crosses two visual systems; the auth pages changed by tokens only. *(Was: dark only, ADR-098 §3.)*

Tenant colour (`tenants.primaryColor`, `TenantBrandingProvider`) is **not applied** on public surfaces; today it overrides `--primary` on the auth pages, so a tenant colour that fails on near-black would break the sign-in button (05 §5.8). A tenant-pinned login shows the tenant's **logo and name** only. An arbitrary tenant colour cannot be contrast-checked against the public surface in advance, and a second accent breaks the one-accent rule.

### 4.2 Colour, with computed contrast

**Amended 2026-10-05 by ADR-118 (P10-17): warm and light.** The owner replaced the dark set with ivory, cream and charcoal, one copper accent, a decorative soft gold, and dark teal only as the "verified" marker. The dark values of 2026-09-29 are in git history (`git show 1100658:docs/UI-UX/20-LANDING-AUTH-REVAMP.md`). Ratios are WCAG 2.1 relative-luminance ratios, computed 2026-10-05 from `frontend/src/app/public-surface.css` with the formula in SC 1.4.3; `publicTokens.contrast.p1001.test.ts` recomputes every number below from the CSS, so the table cannot drift.

**Surfaces**

| Token | Hex | Use |
|---|---|---|
| `--pub-bg` | `#FBF7F0` | page background (ivory) |
| `--pub-surface` | `#F4ECDF` | alternate bands, panels, the auth form column (cream) |
| `--pub-raised` | `#FFFDF8` | cards, inputs, the verdict card (paper) |
| `--pub-glow` | `#F2DFC6` at most | the brightest point of the warm light behind the hero; **text may sit on a glow only if it passes against this value** |

**Foreground, ratio against each surface**

| Token | Hex | on `bg` | on `surface` | on `raised` | on `glow` | Permitted use |
|---|---|---|---|---|---|---|
| `--pub-text` | `#1F1B17` | **16.02** | 14.59 | 16.83 | 13.15 | all text (charcoal) |
| `--pub-text-muted` | `#4A423A` | **9.23** | 8.40 | 9.69 | 7.57 | body copy, secondary text |
| `--pub-text-subtle` | `#685D52` | **6.00** | 5.47 | 6.31 | 4.93 | captions, footnotes, placeholders |
| `--pub-accent` | `#9A4E22` | **5.64** | 5.14 | 5.92 | 4.63 | links, primary button fill, focus ring, the motif (copper) |
| `--pub-accent-hover` | `#83411B` | **7.18** | 6.54 | 7.55 | — | hover fill, hover link |
| `--pub-accent-pressed` | `#6C3616` | — | — | — | — | pressed fill |
| `--pub-on-accent` | `#FFFDF8` | — | — | — | — | text on the accent: **5.92** on accent, 7.55 on hover, 9.49 on pressed |
| `--pub-verified` | `#0E5A52` | **7.55** | 6.88 | 7.94 | 6.20 | **"verified" only**: the SAH/VALID verdict, the demo's verified stamp, the workflow's last step |
| `--pub-gold` | `#C49A5B` | 2.42 | 2.21 | 2.54 | — | **decorative only**: rules, the timeline line, dots, glints; never text, never a fill under text |
| `--pub-border` | `#E5D9C7` | 1.30 | 1.19 | 1.37 | — | **decorative dividers only**; never an input or control boundary |
| `--pub-border-strong` | `#8A7B6A` | **3.84** | 3.50 | 4.03 | — | input and control boundaries (SC 1.4.11 needs 3:1) |

**Status, public surfaces only**

| Token | Hex | on `bg` | on `surface` | on `raised` | Use |
|---|---|---|---|---|---|
| `--pub-success` | `#0E5A52` | 7.55 | 6.88 | 7.94 | verdict VALID — the same dark teal as `--pub-verified` |
| `--pub-warning` | `#8A5300` | 5.93 | 5.40 | 6.23 | verdict EXPIRED / NOT YET VALID; the workflow's due badge |
| `--pub-danger` | `#A1282C` | 6.89 | 6.27 | 7.23 | verdict REVOKED / WITHDRAWN, form errors (5.65 on glow) |
| `--pub-neutral` | `#4B525B` | 7.40 | 6.74 | 7.77 | verdict NOT FOUND |

**Inverted section (ADR-118 Amendment 1): deep warm charcoal, never black.** One section per page at most — the landing's verification demo. `.lp-inverted` (`components/public/landing/landing.css`) maps the `--pub-*` names onto these, and paper inside it (`.lp-paper`: the demo certificate, the phone screen) returns to the light values. Ratios recomputed by `publicTokens.contrast.p1001.test.ts`. (These rows sit outside the Foreground table, so the table's own check does not read them.)

| Inverted token | Hex | on `inv-bg` | on `inv-surface` | Use |
|---|---|---|---|---|
| inv `--pub-inv-bg` | `#241E19` | — | — | the section's background |
| inv `--pub-inv-surface` | `#2F2721` | — | — | panels inside it |
| inv `--pub-inv-text` | `#F6EFE4` | 14.42 | 12.83 | all text |
| inv `--pub-inv-text-muted` | `#D2C4B2` | 9.63 | 8.57 | body copy, captions |
| inv `--pub-inv-accent` | `#E3A47B` | 7.74 | 6.88 | links, primary button fill, focus ring |
| inv `--pub-inv-accent-hover` | `#EDB892` | 9.31 | 8.28 | hover fill |
| inv `--pub-inv-verified` | `#7CCFC0` | 9.06 | 8.06 | verified, on dark |
| inv `--pub-inv-border-strong` | `#9C8C7A` | 5.06 | 4.50 | control boundaries (≥ 3:1) |
| inv `--pub-inv-border` | `#4A3F35` | 1.61 | 1.43 | decorative dividers only |

Text on the primary button in the inverted section: `--pub-inv-on-accent` `#241E19` — **7.74** on the accent, 9.31 on hover.

**Dark mode (ADR-118 Amendment 3).** The surfaces are espresso `#1A1511`, `#231C17` and `#2D251F`, with glow `#3A2B1F`. They are applied by `.dark` on `<html>`, the app's one theme switch, shared with the dashboard. When the visitor has not chosen, `prefers-color-scheme: dark` applies them instead. Ratios are recomputed by `publicTokens.contrast.p1001.test.ts`.

| Dark token | Hex | on `bg` | on `surface` | on `raised` | on `glow` | Use |
|---|---|---|---|---|---|---|
| dark `--pub-dark-text` | `#F6EFE4` | 15.86 | 14.71 | 13.17 | 11.90 | all text (ivory) |
| dark `--pub-dark-text-muted` | `#D4C7B5` | 10.90 | 10.11 | 9.05 | 8.18 | body copy |
| dark `--pub-dark-text-subtle` | `#B9A994` | 7.91 | 7.33 | 6.57 | 5.93 | captions |
| dark `--pub-dark-accent` | `#E3A47B` | 8.51 | 7.89 | 7.06 | 6.38 | links, primary fill, focus ring (lightened copper) |
| dark `--pub-dark-accent-hover` | `#EDB892` | 10.24 | 9.50 | 8.50 | 7.68 | hover fill |
| dark `--pub-dark-verified` | `#7CCFC0` | 9.96 | 9.24 | 8.27 | 7.47 | verified / success |
| dark `--pub-dark-warning` | `#F2B55E` | 9.96 | 9.24 | 8.27 | 7.47 | warning status |
| dark `--pub-dark-danger` | `#F49393` | 8.14 | 7.55 | 6.76 | 6.11 | danger status, form errors |
| dark `--pub-dark-neutral` | `#CDD2D9` | 11.92 | 11.05 | 9.90 | 8.94 | neutral status |
| dark `--pub-dark-border-strong` | `#958572` | 5.07 | 4.70 | 4.21 | 3.80 | control boundaries (≥ 3:1) |
| dark `--pub-dark-gold` | `#8E7247` | 4.01 | 3.72 | 3.33 | 3.01 | decorative only |
| dark `--pub-dark-border` | `#3D332A` | 1.47 | 1.36 | 1.22 | 1.10 | decorative dividers only |

Text on the dark primary fill (`--pub-dark-on-accent` `#1A1511`): **8.51** on accent, 10.24 on hover, 12.05 on pressed.

**Forbidden pairings (each fails, measured):**

- `--pub-gold` as text on ivory: **2.42**; white on the gold: **2.59**. The gold is decoration only.
- The brand teal `#00DAB4` (the mark's fixed accent, `BrandIcon`) as text on `--pub-bg`: **1.68**. It stays inside the logo, which SC 1.4.3 exempts.
- `--pub-border` as an input boundary: 1.37 on raised. Inputs use `--pub-border-strong`.

**The accent and "verified" differ in hue, not much in luminance** (copper vs teal: **1.34**). So the copper accent never appears inside or beside the verification verdict card, and every status is carried by its **word and icon** (08 § Never Colour Alone).

### 4.3 Typography

| Role | Family | Licence | Weights loaded | Used for |
|---|---|---|---|---|
| Display | **Instrument Serif** | SIL OFL 1.1 | Regular 400, Italic 400 (the Italic shipped since ADR-118, for one emphasised phrase per headline) | `h1`, section headlines (≥ 32 px), the hero's kicker, the verification verdict word |
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
| **Amended by ADR-118 (P10-17)** | **Now permitted**, all inside `prefers-reduced-motion: no-preference`, transform/opacity only, 200–600 ms: a CSS-only staggered hero entrance at first paint in which the `<h1>` only rises (never from opacity 0); CSS scroll-driven reveals (`animation-timeline: view()`) — text blocks rise without fading, photographs and decorative layers may fade — and parallax on photographs and decorative layers only; a decorative hero layer that follows a fine pointer by ≤ 12 px; a CSS count-up (`@property`) only on figures inside a *Contoh data* mock-up, with the value in the accessible text; a header that tightens on scroll (fill, hairline, shadow, a 6 % brand scale — never its height); fill-transition buttons with a sliding arrow; the workflow panel's per-step micro-animations; the QR demo's scan line; a smooth `<details>` open via `::details-content`. **Still forbidden:** motion on running text beyond the hero's one rise, magnetic buttons, gradient text, marquees, autoplay video, scroll-jacking, smooth-scroll libraries, loops without a pause (the due badge pulses three times), animation libraries on public pages. Styles: `frontend/src/components/public/landing/landing.css` |

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

- **Visual (ADR-118):** a licensed photograph of a technician measuring a circuit board (`marketing/people/technician-bench.webp`, `next/image`, `priority` — **the LCP element**, budget §13), with the real product screenshot (`hero.webp`) and a small *Contoh data* summary card (two count-up sample figures, the dark-teal *SAH* mark) overlapping it, the precision motif behind, a warm light. Caption *Foto ilustrasi · Tampilan produk: contoh data*. Above the `<h1>`: a greeting that follows the visitor's clock (*Selamat pagi, tim IPSRS dan mutu rumah sakit.*) and a serif kicker (*Saat survei datang, Anda ingin **semuanya sudah siap.***). The sourced eyebrow sits under the CTAs with the sign-in link. *(Was: the screenshot alone over a teal light.)*
- **Removed from today's hero** (P10-00): the "12,000+ instruments" pill and pulsing dot, `heroStats`, `HeroChips` ("99.2% on schedule", "Audit-ready"), the four randomuser.me faces, the "ISO 17025 · Traceable standards" eyebrow, the "Start free trial → /login" CTA (05 H1–H9). "Every result traceable" goes too: metrological traceability is a property of the laboratory's process, and `calibration_records.standard` is free text with no reference-standard chain behind it (05 H2–H3, `calibrationRecord.model.ts:121`).
- **CTAs:** primary **WhatsApp** (`https://wa.me/<number>?text=<prefilled, encoded>`), secondary **email** (`mailto:<address>`). Both come from configuration, not code: `NEXT_PUBLIC_CONTACT_WHATSAPP` and `NEXT_PUBLIC_CONTACT_EMAIL` (ADR-098 §8.8). **A channel whose value is empty is hidden, never shown as a placeholder.** The request-access link (*Minta akses untuk rumah sakit Anda →* `/request-access`) is always present, so the hero never ends up with no way forward.

### 6.2 The problem, in the hospital's words

One short band, no numbers: overdue devices found during a survey; certificates in binders; "who calibrated this, and against what?" asked with the surveyor in the room. Three short statements, serif, large. No statistics (there are none we can source).

**ADR-118:** the three statements become **scenario cards** ("Skenario · Pagi hari survei" …), staggered on desktop, each with a second line "Dengan Device Calibrator: …" stating what the product does (sourced in §11.1, `landing.moments.*.after`), beside a licensed photograph of paper files. Scenarios, not testimonials: no names, no quotes attributed to anyone.

### 6.3 Features and the workflow story

A horizontal story of six steps, each a real UI crop plus two lines. On desktop it is a sticky left column of step titles and a right column that swaps the crop as the reader scrolls (CSS `position: sticky` + `IntersectionObserver`; no scroll-jacking). On mobile and under reduced motion it is a plain vertical list. **ADR-118:** a progress rail fills as the reader moves through the steps, the panel shows "Langkah n dari 6", and each step has its own decorative micro-animation in the panel (CSV rows flowing in, the due badge pulsing three times, the needle settling, a certificate rising, a signature drawing itself, a dark-teal "verified" stamp). Below the story, the further capabilities are a **bento** (unequal spans on a six-column grid, icons, a gentle hover lift), not a uniform list.

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

A single field and a button: *Nomor sertifikat* → **Periksa**. Submitting navigates to `/verify/<number>` (a plain `<form method="get">` to a small route that redirects; works without JS). Beside it, a phone mock-up of a real verdict on the demo tenant's certificate. This is the most persuasive thing on the page (14 § Landing) and it is a working tool, not an illustration. **ADR-118:** below it, an **interactive demo**: a sample certificate with a QR code (it encodes the plain text *CONTOH DATA — Device Calibrator*, not a link) and an auditor's phone; *Pindai kode QR* runs a 1.1 s scan line, then the phone shows the same verdict word and lead as the real `/verify` page for a valid certificate (*SAH* + `verify.validLead`) in dark teal, announced in a polite live region; under reduced motion the verdict appears at once. Everything in it is labelled *Demonstrasi dengan contoh data*.

The field does not autocomplete from history (`autocomplete="off"`), accepts paste, trims whitespace, and does not reveal anything itself: the verdict is `/verify`'s job.

**A typed number gets the minimal verdict.** Certificate numbers are sequential (`CERT-YYYYMMDD-<tenant code>-NNNN`) and the verify endpoint returned device, serial and signer behind only the global limiter (A-293, research 05 §5.9). Working decision (ADR-098 §8.7, Q-47, awaiting owner confirmation): the QR carries a random verification token of at least 128 bits; a lookup **by number** returns only the minimal verdict (valid / revoked / expired, the issuing tenant, dates — no serial number, no signer name) under a per-IP rate limit. **A security agent is implementing that now; Phase 10 references it (P10-14) and does not re-plan it.** The field ships once that change is DONE; until then the section shows the phone mock-up and says that every certificate carries a QR code.

### 6.6 How we work with hospitals

Three steps as text: *Diskusi kebutuhan → Uji coba (pilot) → Penerapan dan pendampingan*. No durations and no promises until the owner states them. **ADR-118:** a numbered timeline with one sentence per step (`landing.work.step*Text`, §11.1) beside a licensed photograph of two hospital staff talking, captioned as an illustration of no one connected to the product.

### 6.7 FAQ

Native `<details>`/`<summary>` (keyboard and screen-reader accessible without script). Six questions, answers cited in §11: What is Device Calibrator? Does it perform calibration? Is our data separated from other hospitals? Can staff sign in with our hospital account (SSO)? Does it support Indonesian? How is the certificate checked by an auditor? **No pricing question** (no answer we can give).

### 6.8 Contact and footer

A final band repeating the two CTAs, then the footer: **only links that have a destination** (today every footer link except the product anchors is `href="#"`: Documentation, API Reference, Community, Contact, About, Careers, Partners, Privacy, Terms; 05 G6), *Kebijakan privasi* once the notice exists (release checklist §14), the language form, and `© {year} {legal entity}` (**Q-43**). No social links unless the owner supplies real accounts.

### 6.9 Removed from the landing

`TrustSection` (fictional hospital marquee, one of them the name of a real hospital network, and badge chips), `TestimonialsSection`, `PricingSection` (incl. "14-day free trial · No credit card"), `PlatformSection` (a Pexels "graph on laptop" photo presented as the product under an invented `app.hdc.health` URL, 05 P1), the "Audit prep: Days → minutes" card (05 C9), the patient-monitor photo (05 F9), `SecuritySection.tsx` (delete the file, 05 §3.11), the `accreditations`, `testimonials`, `partners`, `pricingTiers`, `heroStats` exports in `frontend/src/data/landing.ts`, the four `avatar-*.jpg` files, and the "Start free trial" link in `frontend/src/app/blog/[slug]/page.tsx`. P10-00 removes the fabricated items **before** any redesign.

### 6.10 The landing as built after ADR-118 Amendment 1 (P10-17, 2026-10-05)

The owner's final brief (`.claude/commands/redesign-landing.md`) asked for a change of composition, not a reskin. In order, with the rhythm *dense → airy → immersive → editorial → interactive → minimal*:

1. **Hero** (dense):
   - text on ivory, with a time-of-day greeting, the kicker and the unchanged `<h1>`/lead/CTA;
   - a full-bleed photograph of a technician, revealed by a mask;
   - one interactive element: the precision gauge's needle follows a fine pointer, and simply settles on touch.
2. **Story** (airy): the three survey moments as large serif lines with a number and a time label. No cards.
3. **Human moment** (immersive): a full-bleed photograph of paper files with one sentence over a warm veil.
4. **Transformation**:
   - a before/after comparison — the paper files against the real due list (sample data) — operated with a native range input;
   - the three "Dengan Device Calibrator" statements.
5. **Product experience**: the six-step sticky story (§6.3). Below 1024 px it is a swipeable scroll-snap strip.
6. **Personalization**:
   - an explorable sample certificate (invented hospital, location, device, standard, technician and signer, labelled *Contoh data*);
   - four numbered markers, each a button, explain where each part comes from (claims sourced in §11.1).
7. **Verification** (interactive, the inverted section): the QR demo (§6.5) on deep warm charcoal.
8. **Proof** (minimal), with no testimonials:
   - it says plainly that there are no customer stories yet and that none will be invented;
   - it links to what the visitor can check: verification, security controls, how we work;
   - real stories, with permission, go in `customerStories.ts`, which is empty and renders nothing.
9. **Compliance and security**: an editorial split with a full-height photograph, standards, controls and the disclaimer.
10. **Juga tersedia** (`#fitur`): a numbered typographic index. No cards and no icons.
11. **How we work** (`#cara-kerja`): a timeline and a photograph.
12. **FAQ**.
13. **Closing**: a kicker, a very large serif line, the contact buttons.

**Removed in the second pass:** the scenario cards, the bento grid, the hero's dark product-screenshot overlay and its count-up summary card. The CSS count-up permission in §4.5 is unused. **Navigation:** workflow, verification, security, *Masuk*, ID/EN and *Hubungi kami*. `#fitur` and `#faq` stay as anchors on the page. Type on the landing: Instrument Serif plus Plus Jakarta Sans only; JetBrains Mono is not used there.

---

## 7. Sign-in (`/login`)

### 7.1 Layout

Cinematic split-screen (owner brief). Left, ≥ 1024 px only: `--pub-bg` panel with the precision motif, the product glimpse, and one line of copy — **no claims** (today's `AuthBrandingPanel` says "HIPAA-ready access controls" and "ISO 17025-aligned workflows"; research 04 C13). Right: the form on `--pub-surface`, 400–440 px wide.

- **Exactly one `<h1>` at every width**, and it is in the **form**, not the panel: *Masuk ke Device Calibrator* (or *Masuk ke {tenantName}* on a tenant-pinned build). The panel's headline becomes a `<p>`. Today the `<h1>` moves between panel and form by breakpoint (`AuthBrandingPanel.tsx:65`, `login/page.tsx:77`).
- Top-left: *← Kembali ke beranda*. Top-right: the language form.
- A tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`, `useAuthBrand`, `GET /tenants/public`) shows the tenant logo above the `<h1>` and its name in it. No tenant colour (§4.1).

**Amended by ADR-118 Amendment 1 (P10-17, 2026-10-05) — presentation only:**

- **The left panel** shows a lazy-loaded editorial photograph behind a warm veil, one serif line, and a small sample certificate whose QR "forms" once on load. There is no dashboard screenshot, and the panel is still `aria-hidden` with no heading.
- **Below 1024 px** the panel collapses to a 6 px warm band.
- **Sign-in** greets the visitor by time of day, adds one calm context line, and says "sign in to continue to the page you were on" when a `callbackUrl` is present. Hints appear on blur, steps ease in, and errors rise softly instead of shaking. The OTP field is one large `one-time-code` input.
- **Request access:**
  - calm two-section progress that follows focus (all fields stay on the page — the payload is identical, `authPresentation.p1017.test.tsx`);
  - validation on blur;
  - a success summary with the three next steps;
  - a designed closed state.
- **Not touched:** `useLoginForm.ts`, `auth.service.ts`, the API routes, cookies, redirects or messages.

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
| `landing.security.passkey` | Kunci sandi (passkey), termasuk masuk tanpa kata sandi. | Passkeys, including passwordless sign-in. | `webauthn.route.js`; P10-10 passwordless sign-in DONE (ADR-108; live in the P10 browser suite, *passkey sign-in with Key A/B*). Rewritten 2026-10-05 (P10-17) as §11 asked |
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
| **P10-17 (ADR-118), 2026-10-05** | | | |
| `landing.hero.kicker` | Saat survei datang, Anda ingin | When the survey comes, you want | an invitation, not a claim ("you want"); precedes the unchanged `landing.hero.title` |
| `landing.flow.lead` | Enam langkah, satu catatan yang utuh — dari alat masuk daftar sampai auditor memindai kode QR. | Six steps, one unbroken record — from a device joining the list to an auditor scanning the QR code. | the six steps above (`landing.flow.*`, each sourced); `certificate.model.ts` (`deviceId`, `calibrationRecordId`) links them into one record |
| `landing.moments.1.after` | Dengan interval per alat, yang jatuh tempo dan yang terlambat tampil di satu daftar sebelum surveyor datang. | With an interval per device, what is due and what is overdue show on one list before the surveyor arrives. | 05 W4; `calibrationScheduler.service.js` (due and overdue work orders); the due/overdue list (`step-schedule.webp`) |
| `landing.moments.2.after` | Setiap sertifikat terhubung ke alat dan catatan kalibrasinya, jadi tidak ada lagi yang dicari di map. | Every certificate is linked to its device and its calibration record, so nothing is left to hunt for in binders. | `backend/src/models/certificate.model.ts` (`deviceId`, `calibrationRecordId`, associations lines 495–501) |
| `landing.moments.3.after` | Catatan kalibrasi menyimpan teknisi, standar acuan, dan ketidakpastian pengukurannya; koreksi dibuat sebagai catatan baru. | Each calibration record holds the technician, the reference standard and the measurement uncertainty; a correction is a new record. | `backend/src/models/calibrationRecord.model.ts` (`performedBy`, `standard`, uncertainty; `supersedesId`, `correctionReason`); migration 0057; ADR-062 |
| `landing.work.step1Text` | Kami mendengarkan cara tim Anda bekerja hari ini: daftar alat, jadwal, dan dokumen yang biasa diminta saat survei. | We listen to how your team works today: the device list, the schedule, and the documents a survey usually asks for. | describes the sales conversation (`landing.work.steps`); no duration or deliverable promised |
| `landing.work.step2Text` | Coba dengan sebagian alat dan satu tim, supaya Anda menilai sendiri sebelum memutuskan. | Try it with some of your devices and one team, so you can judge for yourselves before deciding. | describes a pilot (`landing.work.step2`); scope agreed with the hospital, nothing promised |
| `landing.work.step3Text` | Penerapan bertahap bersama tim Anda, dengan orang yang bisa Anda hubungi saat ada pertanyaan. | A gradual rollout with your team, and a person to contact when questions come up. | describes rollout and support (`landing.work.step3`); "a person to contact" is the configured contact channels (Q-41, doc 20 §14 — someone must answer them before go-live) |
| `landing.cert.hs.1.text` | Merek, model, lokasi, dan interval kalibrasi diambil dari catatan alat yang sama. | Make, model, location and calibration interval come from the same device record. | `backend/src/models/calibrationDevice.model.ts` (make, model, location, interval); `certificate.model.ts` `deviceId` (P10-17 certificate explorer) |
| `landing.cert.hs.2.text` | Standar acuan, ketidakpastian pengukuran, dan teknisi tercatat pada catatan kalibrasi yang tidak dapat diubah. | The reference standard, measurement uncertainty and technician are on a calibration record that cannot be edited. | `calibrationRecord.model.ts` (`standard`, uncertainty, `performedBy`); append-only, migration 0057, ADR-062 (P10-17 certificate explorer) |
| `landing.cert.hs.3.text` | Penandatangan mengautentikasi ulang sebelum menandatangani. | The signer re-authenticates before signing. | `eSignature.service.js` (A-65 re-authentication) (P10-17 certificate explorer) |
| `landing.cert.hs.4.text` | Siapa pun dapat memindai kodenya dan melihat status sertifikat, tanpa login. | Anyone can scan the code and see the certificate's status, without signing in. | `certificates.route.js:38`; `/verify` page; `frontend/src/lib/certificatePdf.ts` (QR of `verifyUrl`) (P10-17 certificate explorer) |
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
| Brand recolour (P10-17, ADR-118 Am. 2) — `frontend/public/brand/` `mark.svg`, `mark-dark.svg`, `lockup-light.svg`, `lockup-dark.svg`, `app-icon.svg`, `logo-email.png`; `frontend/public/favicon.ico`, `apple-touch-icon.png` | the project's own logo above, recoloured 2026-10-05 at the owner's request; shape unchanged | as the row above (the project's own asset) | fills only: charcoal `#1F1B17` + copper `#9A4E22` on light, ivory `#F6EFE4` + light copper `#E3A47B` on dark/the `#241E19` tile; `lockup-mono.svg` unchanged; PNG/ICO regenerated from the SVGs with `sharp`; record `MEMORY/records/2026-10-05-logo-warm-recolour.md` |
| Precision-scale motif (SVG) | drawn in-house for P10-01 | owned | graduation ticks, tolerance band, needle; tokens only |
| Grain texture `frontend/public/textures/grain.svg` | generated in-house (`feTurbulence`) | owned | static file, applied as a CSS background (no inline `<style>`) |
| Workflow screenshots — `frontend/public/marketing/product/`: `step-device.webp`, `step-schedule.webp`, `step-calibrate.webp`, `step-certificate.webp`, `step-sign.webp`, `step-verify.webp` | **re-captured 2026-10-05 (P10-17, QA M4)** with puppeteer at 2× from the product's own dashboard in **light** theme and the warm `/verify` page on a phone (390 px). The source was the disposable `p1017warm` stack: the demo tenant seeded by `seed-demo` (development mode), plus seven invented devices (`CONTOH-*` serials; makers "Contoh Medika", "Alat Sehat", "Nusantara Instrumen"). The browser suite's own test rows were removed from the page before capture, and nothing else was altered. The demo certificate's `valid_until` was moved forward in that throwaway database so the phone shows *SAH*. WebP q80, 1280×800 (sign 760×1127, verify 780×1688). `hero.webp` was deleted: it is no longer used | owned | no real hospital, patient or staff names (demo users only); captioned "Contoh data / Sample data" wherever shown; re-capture on the release build (§14) |
| `frontend/public/marketing/ASSETS.md` | the readable summary of every public asset's source, creator and licence (P10-17, brief §9) | — | kept in step with this register |
| `frontend/public/marketing/CREDITS.md` | this register's human-readable companion | — | lists what P10-00 removed and what P10-17 added |
| `frontend/public/marketing/people/technician-bench.webp` (auth panel; was the landing hero in the first pass) | https://unsplash.com/photos/a-technician-is-working-on-an-electronic-circuit-M64oBzDDjsY — by **Arabian Infotech Qatar** (unsplash.com/@arabaninfotechqatar), published 2025-04-05 | **Unsplash License** (https://unsplash.com/license): free for commercial use, modification permitted, no attribution required; not permitted: selling unaltered copies, compiling a competing image service. Checked `premium: false`, `plus: false` on 2026-10-05 | **What it shows:** a technician in safety glasses measuring a circuit board with a multimeter at a workbench. Cropped 4:5 at 1278×1597 (the source's full height, no upscaling), WebP q66 (109 KB). Captioned *Foto ilustrasi*; not a customer or our staff; no logo or name. P10-17, ADR-118 |
| `frontend/public/marketing/people/paper-stacks.webp` (moments) | https://unsplash.com/photos/stacks-of-paper-documents-and-file-folders-snNHKZ-mGfE — by **Wesley Tingey** (unsplash.com/@wesleyphotography) | Unsplash License, as above; checked 2026-10-05 | **What it shows:** stacks of paper files and folders in an office; no people. 1400×933, WebP q68 (78 KB). Captioned *Foto ilustrasi* |
| `frontend/public/marketing/people/records-review.webp` (compliance) | https://unsplash.com/photos/woman-signing-on-white-printer-paper-beside-woman-about-to-touch-the-documents-HJckKnwCXxQ — by **Gabrielle Henderson** (unsplash.com/@gabriellefaithhenderson) | Unsplash License, as above; checked 2026-10-05 | **What it shows:** two people at a grey table going through printed documents, one writing; cropped at the shoulders, no face. 1800×1200 since the second pass (sharper at 1280 px), WebP q66 (83 KB). Captioned *Foto ilustrasi*. (A darker clipboard photo, WNlFy0_apVQ, was tried first and dropped: it read as night on the light page) |
| `frontend/public/marketing/people/clinician-monitor.webp` (landing hero, the LCP image on desktop) | https://unsplash.com/photos/a-man-in-scrubs-and-a-stethoscope-looking-at-a-monitor-0Fv4M2hSZJU — by **César Badilla Miranda** (unsplash.com/@xbmpro) | Unsplash License, as above; `premium: false`, `plus: false` checked 2026-10-05 | **What it shows:** a clinician in scrubs, mask and cap adjusting a vital-signs monitor; face partly covered; no hospital name or logo. 1600×1067, WebP q70 (46 KB). Captioned *Foto ilustrasi*. Replaced `technician-bench.webp` as the landing hero in the second pass (owner: imagery contextual to medical devices; ADR-118 Am. 3); `technician-bench.webp` stays on the auth panel |
| `frontend/public/marketing/people/late-paperwork.webp` (the full-bleed "human moment") | https://unsplash.com/photos/a-woman-sitting-at-a-table-with-lots-of-papers-ZH4FUYiaczY — by **Dimitri Karastelev** (unsplash.com/@dkfra19) | Unsplash License, as above; checked 2026-10-05 | **What it shows:** two hands, a pen and a fan of printed papers on a dark table in low light; no face. 2000×1125, WebP q62 (26 KB). Replaced the second use of `paper-stacks.webp` in a row (QA, 2026-10-05) |
| `frontend/public/marketing/people/device-check.webp` (how we work) | https://unsplash.com/photos/a-person-adjusts-a-medical-monitor-in-a-tiled-room-Scr5C6EGz9I — by **Alexander Mass** (unsplash.com/@alexandermassph) | Unsplash License, as above; checked 2026-10-05 | **What it shows:** a staff member seen from behind (no face) setting a wall-mounted monitor on a ward; the monitor maker's small badge is visible. 1120×1400, WebP q70 (19 KB). Captioned *Foto ilustrasi — orang dan tempat dalam foto ini tidak terkait dengan Device Calibrator* |
| ~~`hallway-conversation.webp`~~ (Centre for Ageing Better, 7FHjL_TJlA8) | — | — | **removed 2026-10-05 (second pass)**: identifiable faces and a real UK hospital's uniforms — exactly what brief §9 asks to avoid |
| Instrument Serif Italic `frontend/src/app/fonts/instrument-serif-latin-400-italic.woff2` | @fontsource/instrument-serif 5.3.0 (jsDelivr), from https://github.com/Instrument/instrument-serif | SIL OFL 1.1 | `frontend/public/licenses/OFL-InstrumentSerif.txt` (same family); 22.1 KB; five public font files now 79.5 KB (≤ 90 KB). P10-17 |
| Warm grain `frontend/public/textures/grain-warm.svg` | generated in-house (`feTurbulence`, a warm-brown noise at 5 %) | owned | replaces `grain.svg` (white noise, invisible on ivory) as the public background texture. P10-17 |
| **Assets still needed (owner)** | commissioned photographs of a real, consenting Indonesian hospital team: an IPSRS technician calibrating a device; an assessor scanning a certificate's QR with a phone; a quality team preparing for a survey; a short (≤ 10 s, muted, with a pause control) hero clip is optional | owner's own, with model releases | until then the four Unsplash photographs above stand in, captioned as illustrations (ADR-118) |
| Photographs (rule) | **Since ADR-118:** Unsplash or Pexels only, free for commercial use, self-hosted, captioned as illustrations, registered here with source, author, licence and subject. *(Was "none planned".)* If one is added: Unsplash (https://unsplash.com/license) or Pexels (https://www.pexels.com/license/), no identifiable people or branded equipment, and a model/property release question answered first (research 04 §5.3) | per source | the nine Pexels files in `public/marketing/` are removed with the sections that used them |
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

**AC-5 / AC-6 status, 2026-10-07 (MEASURED; record `MEMORY/records/2026-10-05-landing-warm-redesign.md`, addendum 2026-10-07): not met under Lighthouse simulation on the workstation.**
- Lighthouse, simulated:
  - `/`: Performance **89**, LCP **3.42 s** (was 88 and 3.61 s).
  - `/login`: Performance **92**, LCP **2.95 s** (was 93 and 3.11 s).
  - Accessibility, Best Practices and SEO: 100 on both.
  - CLS: 0 on `/`, 0.015 on `/login`.
- Under throttling applied in a real browser (4× CPU, 150 ms, 1.6 Mbps), LCP is met:
  - `/`: **1.87 s**.
  - `/login`: **≈ 1.0 s**.
- Why simulation stays above the targets:
  - Lighthouse's simulation counts every byte that finished before the observed paint.
  - On this host the framework's ~133 KB of JavaScript finishes first, which alone puts `/login` at **2.77 s**.
  - `/` with no JavaScript at all is still **2.64 s**.
- Still open:
  - a WebPageTest run and a run on the VM or a dedicated host;
  - `/login` INP sits at about 200 ms, from the theme toggle.
- The changes made, all without design or content change:
  - `content-visibility` on the landing's sections below the hero;
  - the public surface no longer inherits the dashboard's font features;
  - the grain is inlined;
  - the demo QR path is shorter;
  - `/login` loads its API layer on demand (first-load JS 154.2 → 130.9 KB brotli).

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

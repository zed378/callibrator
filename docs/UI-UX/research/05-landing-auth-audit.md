# Research 05 — Landing, Auth and Public Verification: As-Built Audit

**Date:** 2026-09-29 · **Type:** code audit (the frontend and the backend it calls, read file by file). No users were studied, no browser was driven, and no axe or Lighthouse run was made for this document. · **Status:** input to the landing/auth revamp. It records what exists. Every decision it implies goes through the owner (see [`00-owner-brief-landing-auth.md`](./00-owner-brief-landing-auth.md)) or an ADR.

**Read with:** [`00-owner-brief-landing-auth.md`](./00-owner-brief-landing-auth.md) (the owner's decisions), [`02-standards-and-benchmarks.md`](./02-standards-and-benchmarks.md), ADR-071 (nonce CSP), ADR-090 (contrast tokens, one `<main>` and one `<h1>`), ADR-075 / ADR-051 Q-11 (self-registration policy) in [`../../../MEMORY/DECISIONS.md`](../../../MEMORY/DECISIONS.md).

---

## 0. Method, and How Far to Trust Each Claim

| Evidence | How it was obtained | Confidence |
|---|---|---|
| What a page renders, what it calls | the page and every component it imports, read in full | **high** |
| Whether an endpoint exists | the route file in `backend/src/routes/api/` and its mount in `backend/index.js` | **high** |
| Whether a marketing claim is backed by code | a search of `backend/src` (non-test) plus the model and service that would implement it | **high** for "exists / does not exist". **Medium** for "works as described": nothing here was run |
| Rate-limit behaviour | read from `rateLimiter.redis.service.js`, `rateLimitConstants.ts`, `index.js`. **Not exercised** | medium: a reading, not a measurement |
| Bundle weight | the production `.next/` build on disk (timestamp 2026-09-29 17:47), chunks resolved from each page's `_client-reference-manifest.js` plus the root main files, gzipped locally | medium: a dated snapshot, not a Lighthouse run; recount before quoting |
| Contrast | inferred from the ADR-090 token table and the classes used. **Not measured** | low to medium |
| Indonesian hospital accreditation (KARS/SNARS/STARKES) | background knowledge, not fetched for this document | **medium: confirm with the owner before any copy names a standard** |

Classifications used in §3: **OC** over-claimed (a feature, certification, number, customer or person that does not exist or is not backed by code) · **OP** over-promised (a guarantee: "never", "nothing", "complete", "accepted") · **V** vague (true-ish but says nothing checkable) · **OK** fine as written.

---

## 1. Summary

1. **The landing page is built on fabricated social proof.** Three headline metrics, a "live" counter, four named testimonials with real-looking faces and 5-star ratings, six "partner" hospital names, and five certification chips (including **HIPAA** and **SOC 2**) are placeholders. The code says so itself (`frontend/src/data/landing.ts` header, `frontend/public/marketing/CREDITS.md`). They ship to production as written.
2. **Several feature claims describe features the code does not have:** barcode scanning, automatic pass/fail, technician auto-assignment, a traceable reference-standard chain, KARS/SNARS evidence packaging, multi-region data residency, prebuilt CMMS/LIS connectors, a free trial, and (in an unused component) end-to-end encryption, database-level tenant isolation, cross-region backups and quarterly DR drills.
3. **The platform really does support compliance work**, and there is enough true material to replace everything removed: an append-only audit log (`REVOKE UPDATE, DELETE`), append-only calibration records with correction/void history, Part 11-style e-signatures with re-authentication, SHA-256 integrity hashes on certificates, public QR verification, TOTP MFA with recovery codes, SAML and OIDC SSO, passkey enrolment, CSV import and CSV report export, API keys and webhooks, per-tenant branding. §3.14 lists them with their files.
4. **"Create a tenant workspace" is false.** `POST /api/v1/auth/register` creates a user with **no tenant**, who sees nothing (ADR-075). There is no request-access, lead or onboarding endpoint anywhere. The owner's "request access + approve queue" needs a new model, three to five endpoints, a super-admin screen and two emails (§6).
5. **The login page offers password and SSO only.** Passkeys cannot sign anyone in today: every `/api/v1/webauthn/*` route sits behind `auth` (it is a step-up and e-signature factor). A passkey button on the login page needs backend work (§5.4).
6. **There is no forgot-password page**, although `send-otp` and `reset-password` exist and are enumeration-safe. The login form has no link to one.
7. **Enumeration and abuse surfaces:** register answers `409 Email already registered` / `Username already used`; SSO answers `404 Tenant not found` vs `400 SSO is not enabled`; certificate numbers are sequential (`CERT-YYYYMMDD-<tenant code>-NNNN`) and the public verify endpoint returns device, serial number, signer and document behind only the global limiter. By reading the limiter code, register and send-OTP are not limited per caller unless `AUTH_RATE_LIMIT_BY_IP=true` (off by default).
8. **Brand name drift:** the same product is "Hospital Device Callibrator" (`<title>`), "HDC" (nav, blog), "Device Calibrator" (footer, auth default, logo SVG `<title>`), and "Callibrator" (repository). The owner said "keep the current Callibrator logo and name", so **which string is the name** is a decision (Q-1 in §9).
9. **Performance:** the landing page is one `"use client"` tree shipping about **305 KiB gzip of JS** (GSAP + ScrollTrigger + SplitText, Lenis, Motion). The `<h1>` is server-rendered at `opacity: 0` and becomes visible only after hydration, which ties LCP to the JS.
10. **Accessibility debt on auth pages:** unwired "Remember me" checkbox, no `autocomplete` tokens, tab and toggle buttons that do not expose their state, error banners without `role="alert"`, the register success state has no `<h1>`, and the landing uses opacity on text (`text-muted-foreground/60`), which ADR-090 forbids.

---

## 2. Inventory

### 2.1 Routes, files, components, endpoints

"Verified" means the route exists in `backend/src/routes/api/*.route.js` **and** is mounted in `backend/index.js` (`/api/v1/auth` l.429, `/api/v1/tenants` l.432, `/api/v1/certificates` l.439, `/api/v1/content` l.459, `/api/v1/oidc` l.469, `/api/v1/webauthn` l.476). The browser reaches the backend through the Next catch-all proxy `frontend/src/app/api/v1/[...path]/route.ts`, except where a Next route handler exists (login, logout, logout-all, refresh, sso-session), which sets the httpOnly cookies.

| Route | File | Components used | Backend endpoints called | Verified |
|---|---|---|---|---|
| `/` | `frontend/src/app/page.tsx` (`"use client"`) | `LandingLayout` → `SmoothScroll` (Lenis+GSAP), `AnimatedBackground`, `ScrollReveal`, `Navigation`, `Footer`; sections `HeroSection` (+`hero/HeroPoster`, `hero/HeroChips`, `AuroraBackground`, `MagneticButton`, `Counter`), `TrustSection` (+`Marquee`), `HowItWorksSection` (+`SplitHeading`, GSAP ScrollTrigger), `FeaturesSection` (+`TiltCard`), `PlatformSection`, `ComplianceSection`, `TestimonialsSection`, `PricingSection`, `CtaSection`. Copy in `frontend/src/data/landing.ts` | none on render. `Navigation` reads `useAuthStore` (session state); root layout's `AuthInitializer` / `TenantBrandingProvider` may call `GET /api/v1/tenants/public` (branding) and `POST /api/v1/auth/verify` | yes (`tenant.route.js:257`, `auth.route.js:366`) |
| `/login` | `frontend/src/app/login/page.tsx` | `AuthBackground`, `AuthBrandingPanel`, `BrandMark`, `Eyebrow`, `PasswordLoginForm`, `SsoLoginForm`, `MfaLoginForm`; hook `login/hooks/useLoginForm.ts` | `POST /api/v1/auth/login` (Next route → backend `auth.route.js:185`); `POST /api/v1/auth/mfa/login` (`:1034`); `POST /api/v1/auth/sso/login` (`:568`); `POST /api/v1/auth/sso/oidc/login` (`:648`) | yes |
| `/register` | `frontend/src/app/register/page.tsx` | same shell; `RegisterInputs`, `RegisterSuccessPanel`; hook `register/hooks/useRegisterForm.ts` | `POST /api/v1/auth/register` (`auth.route.js:79`) | yes (but see §5.5: it creates a tenantless user) |
| `/activation` | `frontend/src/app/activation/page.tsx` | none shared | `GET /api/v1/auth/activation?token=` (`auth.route.js:121`) | yes |
| `/sso-callback` | `frontend/src/app/sso-callback/page.tsx` | local `AnimatedBackground` (not the shared one) | `POST /api/v1/auth/sso-session` (Next route) → backend `POST /api/v1/auth/sso/exchange` (`auth.route.js:805`) | yes |
| `/verify/[certificateNumber]` | `frontend/src/app/verify/[certificateNumber]/page.tsx` | `AuroraBackground`; `lib/certificatePdf` (jsPDF, lazy) | `GET /api/v1/certificates/verify/:certificateNumber` (`certificates.route.js:38`); `GET …/verify/:certificateNumber/document` (`:66`, iframe) | yes |
| `/oauth/consent` | `frontend/src/app/oauth/consent/page.tsx` | none shared | `GET /api/v1/oidc/authorize/request/:requestId` (`oidc.route.js:91`), `POST /api/v1/oidc/authorize/decision` (`:101`) | yes |
| `/blog`, `/blog/[slug]`, `/news`, `/news/[slug]` | `frontend/src/app/blog/…`, `news/…` (server components) | `LandingLayout`, `PostCard`, `CategoryFilter`, `SectionHeading as="h1"` | `GET /api/v1/content/posts/public`, `/posts/public/:slug`, `/categories/public` (`content.route.js:66,87,100`) via `lib/content.api.ts` | yes |
| `/dashboard/mfa` (authenticated) | `frontend/src/app/dashboard/mfa/page.tsx` | `DashboardLayout` | `POST /auth/mfa/setup`, `/mfa/verify`, `/mfa/disable` (`auth.route.js:857,891,935`) | yes |
| `/dashboard/webauthn` (authenticated) | `frontend/src/app/dashboard/webauthn/page.tsx` | `DashboardLayout` | `GET /webauthn/status`, `POST /registration-options`, `/verify-registration`, `/disable` (`webauthn.route.js:48,64,89,171`) | yes |
| `not-found`, `error` | `frontend/src/app/not-found.tsx`, `error.tsx` | — | — | — |

**No imagined endpoint was found on these pages.** Every path the public and auth pages call exists and is mounted. The exposure is the opposite one: backend capabilities with **no page**.

### 2.2 Pages that do not exist

| Missing page | Backend support today | Consequence |
|---|---|---|
| **Forgot password / reset password** | `POST /auth/send-otp` (`auth.route.js:227`), `POST /auth/reset-password` (`:269`); client methods exist (`frontend/src/api/services/auth.service.ts:98,106`) but **nothing calls them** | A locked-out user has no self-service path. The login form has no "Forgot password?" link |
| **Request access** | none (§6) | the owner's primary register flow has no backend |
| **Verify lookup** (`/verify` with a number field) | the endpoint takes the number as a path param, so a client-side form is enough | the landing's "public certificate verification" section needs a form that routes to `/verify/<number>` |
| **Passkey sign-in** | enrolment only; every WebAuthn route is behind `auth` (`webauthn.route.js:13`) | §5.4 |
| **Privacy notice / Terms** | none; footer links are `href="#"` (`Footer.tsx`) | a request-access form collects personal data (name, email, phone, institution): GDPR Art. 13 and Indonesia's UU 27/2022 (PDP) both expect a notice at collection |
| **Contact** | none; footer "Contact" is `#`, CTA "Book a walkthrough" links to `/login` | the owner's primary CTA (sales / WhatsApp) has no destination yet |

---

## 3. Copy Audit

**All current copy is English only.** There is no i18n layer anywhere in `frontend/src` (no dictionary, no `next-intl`, `<html lang="en">` hard-coded in `app/layout.tsx`). Every Indonesian line below is therefore a **new** string. Rewrites are proposals for the mockups, not final copy; Indonesian should be reviewed by a native writer familiar with IPSRS / biomedical terminology.

### 3.1 What the documentation says about certification (the baseline for every rewrite)

- `docs/PLAN/00-PROJECT-OVERVIEW.md` § Non-Goals: **"Callibrator does not issue accreditation. It produces evidence that an accredited body can audit."** and **"It never touches patient data. That is what keeps it outside HIPAA covered-entity scope."**
- The same file lists ISO 17025, 21 CFR Part 11, ISO 13485, GDPR, KARS, SNARS as **"Compliance targets"**, i.e. frameworks the product is designed to support.
- No document or record in `docs/` or `MEMORY/` claims a certification, audit report or attestation of the product or the company. `SOC 2` and `HIPAA` do not appear in any backend source file.
- `TASKS/BACKLOG.md` § Unverified Claims: RTO "a guess", backups "assumed, not known", performance targets "NOT met above low concurrency" (U-04..U-06). `docs/ARCHITECTURE/09-DISASTER-RECOVERY.md`: RPO "no, as shipped"; RTO "measured once".

**Rule for the revamp:** the platform **supports** or **helps prepare evidence for** a framework; it never "is", "meets", "is certified for" or "is accepted by" one. HIPAA and SOC 2 are dropped entirely.

**Accreditation naming (medium confidence, confirm with the owner):** since 2022 Indonesia's hospital accreditation standard is the Ministry of Health's **STARKES** (KMK HK.01.07/MENKES/1128/2022), and KARS is one of several accrediting bodies. "SNARS" (edisi 1.1) is the superseded KARS standard. Copy that names "SNARS" as current may read as dated to hospital leadership. Proposed neutral wording: "akreditasi rumah sakit (Kemenkes)".

### 3.2 Global: metadata, brand, navigation, footer

| # | Location | Verbatim | Class | Evidence | Proposed ID | Proposed EN |
|---|---|---|---|---|---|---|
| G1 | `app/layout.tsx` metadata | "Hospital Device Callibrator" / "Medical device calibration management system" | V + naming | name differs from nav/footer/logo; see Q-1 | "Callibrator — Manajemen kalibrasi & siklus hidup alat kesehatan" | "Callibrator — Calibration and lifecycle management for medical devices" |
| G2 | `Navigation.tsx` | "HDC" | naming | the logo SVG `<title>` is "Device Calibrator" | brand per Q-1 | brand per Q-1 |
| G3 | `Navigation.tsx` | "Sign In" / "Get Started" (both → `/login`) | OC (Get Started) | there is no self-service start | "Masuk" / "Hubungi kami" | "Sign in" / "Contact sales" |
| G4 | `Navigation.tsx` links | "Features · Compliance · Platform · Pricing · Blog · News" | OK except Pricing (owner: no pricing) | — | "Fitur · Kepatuhan · Verifikasi sertifikat · FAQ · Blog" | "Features · Compliance · Verify a certificate · FAQ · Blog" |
| G5 | `Footer.tsx` | "Device Calibrator" + "Streamline your medical device calibration management with our comprehensive enterprise platform." | V | — | "Mencatat kalibrasi, pemeliharaan, dan sertifikat alat kesehatan dalam satu sistem yang dapat diaudit." | "Calibration, maintenance and certificates for medical devices, in one auditable system." |
| G6 | `Footer.tsx` | "Documentation · API Reference · Community · Contact · About Us · Careers · Partners · Privacy Policy · Terms of Service" | OC (all `href="#"`) | dead links | keep only links with a destination; add Kebijakan Privasi when written | same |
| G7 | `Footer.tsx`, `AuthBrandingPanel.tsx` | "© {year} Device Calibrator. All rights reserved." | naming | — | "© {tahun} {nama resmi perusahaan}" | "© {year} {legal entity}" |
| G8 | `blog/page.tsx` metadata | "Field notes on calibration, compliance, and keeping a hospital audit-ready — from the HDC team." | naming, OK otherwise | — | "Catatan tentang kalibrasi, kepatuhan, dan kesiapan audit rumah sakit." | "Notes on calibration, compliance and audit readiness in hospitals." |

### 3.3 Hero (`components/landing/HeroSection.tsx`, `hero/HeroChips.tsx`, `data/landing.ts` `heroStats`)

| # | Verbatim | Class | Evidence | Proposed ID | Proposed EN |
|---|---|---|---|---|---|
| H1 | Live pill with pulsing dot: "12,000+ instruments calibrated within tolerance" | **OC (fabricated live metric)** | hard-coded string; `data/landing.ts` header: "illustrative PLACEHOLDERS" | remove. If a live-looking element is wanted: "Sertifikat dapat diverifikasi publik lewat kode QR" | remove, or "Every certificate is publicly verifiable by QR code" |
| H2 | Eyebrow "ISO 17025 · Traceable standards · Multi-tenant" | OC ("Traceable standards") | `calibration_records.standard` is a free-text string (`models/calibrationRecord.model.ts:121`); no reference-standard registry or chain exists | "Mendukung alur kerja ISO/IEC 17025 · Multi-tenant" | "Supports ISO/IEC 17025 workflows · Multi-tenant" |
| H3 | `<h1>` "Every instrument measured. Every result traceable." | OC (metrological traceability is a property of the lab's process, not of the software) | as H2 | "Setiap alat tercatat. Setiap hasil terdokumentasi." | "Every instrument on record. Every result documented." |
| H4 | "Schedule the work, capture readings against traceable reference standards, and issue tamper-evident certificates — so every measurement holds up the day an auditor asks." | OC ("traceable reference standards") + OP ("every measurement holds up") | integrity hash + public verify exist (`certificatePdf.controller.js`, verify page), so "tamper-evident" is defensible **if** qualified | "Jadwalkan kalibrasi, catat hasil beserta standar acuan dan ketidakpastian pengukurannya, lalu terbitkan sertifikat bertanda tangan elektronik yang keasliannya dapat diperiksa siapa pun lewat kode QR." | "Schedule calibrations, record results with the reference standard and measurement uncertainty, and issue electronically signed certificates whose integrity anyone can check by QR code." |
| H5 | CTA "Start free trial" → `/login` | **OC** | no trial path; tenant `status` ENUM is `active/suspended/deleted` (`models/tenant.model.ts:49`) | "Hubungi tim kami" (primary, WhatsApp/email) | "Talk to our team" |
| H6 | "See how it works" | OK | — | "Lihat cara kerjanya" | "See how it works" |
| H7 | Avatar stack + "Trusted by biomedical & calibration engineers preparing for ISO 17025 & KARS with confidence." | **OC (fabricated people and endorsement)** | `CREDITS.md`: "fictional samples" | remove | remove |
| H8 | Stats: "12,000+ instruments under management" · "40% less time preparing for audits" · "99.2% calibrations completed on schedule" | **OC (unsourced numbers)** | `data/landing.ts`: "Deliberately specific-sounding, still illustrative." | replace with verifiable facts (§3.14), e.g. "Jejak audit append-only" · "Tanda tangan elektronik dengan autentikasi ulang" · "Verifikasi sertifikat publik" | "Append-only audit trail" · "E-signatures with re-authentication" · "Public certificate verification" |
| H9 | Chip "99.2% on schedule" | **OC** | same number, repeated | remove | remove |
| H10 | Chip "Audit-ready" | V | — | use a real UI state label from the screenshot, e.g. "Sesuai" (the `isCompliant` badge) | "Compliant" |
| H11 | Hero image `step-calibrate.jpg` (stock hands on an instrument) | misleading-by-context once the owner wants real UI | Pexels stock | replace with a real product screenshot (owner brief) | same |

### 3.4 Trust strip (`TrustSection.tsx`, `data/landing.ts` `partners`)

| # | Verbatim | Class | Evidence | Proposed ID | Proposed EN |
|---|---|---|---|---|---|
| T1 | "Trusted by biomedical & quality teams across healthcare" | **OC** | no customer list anywhere | remove the section, or retitle: "Dirancang untuk" | "Built for" |
| T2 | Marquee: "Meridian Health · St. Aubyn · Northgate · Valley Regional · PrimeCare · Unity Health" | **OC (fictional customers)**, and some are names of real organisations elsewhere (e.g. "Unity Health" is a real Canadian hospital network) | `data/landing.ts` | remove | remove |
| T3 | Chips "ISO 17025 · HIPAA · KARS · SNARS · SOC 2" | **OC (read as held certifications)** | no SOC 2 / HIPAA anywhere in code or docs; the product holds no patient data | replace with audience chips: "Laboratorium kalibrasi · Teknik biomedis / IPSRS · Manajemen rumah sakit" | "Calibration labs · Biomedical engineering / IPSRS · Hospital leadership" |

### 3.5 How it works (`HowItWorksSection.tsx`, `data/landing.ts` `steps`)

| # | Verbatim | Class | Evidence | Proposed ID | Proposed EN |
|---|---|---|---|---|---|
| W1 | "From loading dock to signed certificate — four steps." | OK | — | "Dari alat masuk hingga sertifikat ditandatangani — empat langkah." | keep |
| W2 | "The same lifecycle every regulated device goes through, minus the spreadsheets and the last-minute audit panic." | V (mild OP) | — | "Siklus yang sama yang dilalui setiap alat kesehatan — tanpa spreadsheet yang tercecer." | "The lifecycle every regulated device goes through — without scattered spreadsheets." |
| W3 | Step 1 "Bring your fleet into one place" / "Scan or import every analyser, monitor, and pump into a single inventory — model, location, owner, and calibration interval on one record." | OC ("Scan", "owner") | CSV import exists (`POST /calibration-devices/bulk-import`, `calibrationDevices.route.js:444`); no barcode/QR scanning code; device model has `manufacturer, model, category, locationId, calibrationIntervalDays` and **no owner field** (`models/calibrationDevice.model.ts`) | "Impor seluruh alat dari CSV atau tambahkan satu per satu — merek, model, lokasi, dan interval kalibrasi dalam satu catatan." | "Import your devices from CSV or add them one by one — make, model, location and calibration interval on one record." |
| W4 | Step 2 "Let schedules run themselves" / "…raises work orders ahead of time, assigns technicians, and warns before anything drifts out of tolerance." | OC ("assigns technicians", "anything drifts") | the scheduler creates preventive work orders for due and overdue devices and a **tenant-wide** notification (`services/calibrationScheduler.service.js:7,112-125`); assignment is manual (`assigneeId`, `maintenance.service.js:136-141`); tolerance alerts exist **only for IoT-connected devices** with `readingTolerance` (`iot.service.js:258`) | "Tetapkan interval per alat; sistem membuat perintah kerja untuk alat yang jatuh tempo atau terlambat dan memberi tahu tim Anda." | "Set an interval per device; the system opens work orders for devices that are due or overdue and notifies your team." |
| W5 | Step 3 "Capture readings at the bench" / "…against traceable reference standards on any device — pass/fail is evaluated the moment values are entered." | **OC** | `isCompliant` is an **entered** field (`CONTENT_FIELDS`, `services/calibrationRecords.service.js:264-275`), not computed | "Teknisi mencatat hasil, standar acuan, dan ketidakpastian pengukuran, lalu menandai hasil sesuai atau tidak sesuai." | "Technicians record results, the reference standard and measurement uncertainty, and mark the result compliant or non-compliant." |
| W6 | Step 4 "Sign, certify, and archive" / "…apply a tamper-evident digital signature, and issue a certificate that's ready to hand an ISO 17025 or KARS auditor — no scramble." | OP ("ready to hand … no scramble") | e-signature workflow exists (`routes/api/eSignature.route.js`, MEMORY: esignature implemented); acceptance is the auditor's call | "Setujui hasil, tandatangani secara elektronik, dan terbitkan sertifikat dengan kode QR dan hash integritas yang dapat diverifikasi publik." | "Approve, sign electronically, and issue a certificate carrying a QR code and an integrity hash anyone can verify." |
| W7 | "See everything the platform does" | OK | — | "Lihat semua kemampuan platform" | keep |

### 3.6 Features (`FeaturesSection.tsx`, `data/landing.ts` `features`)

| # | Verbatim | Class | Evidence | Proposed ID | Proposed EN |
|---|---|---|---|---|---|
| F1 | "What you get" / "The tools a biomedical team actually reaches for." | V | — | "Yang Anda dapatkan" / "Alat kerja untuk tim biomedis dan laboratorium kalibrasi." | "What you get" / "Tools for biomedical teams and calibration labs." |
| F2 | "No feature-list padding — just the capabilities that keep a fleet compliant and a team out of firefighting mode." | OP ("keep a fleet compliant") | — | "Kemampuan inti untuk menjaga catatan kalibrasi tetap lengkap dan dapat diaudit." | "The core capabilities for keeping calibration records complete and auditable." |
| F3 | "Device lifecycle, end to end" / "Every instrument's history — commissioning, calibrations, repairs, retirement — on one auditable timeline." | V/mostly supported | retire/reinstate/restore routes (`calibrationDevices.route.js:351,410`), maintenance work orders, append-only records. "One timeline" view not verified | "Riwayat setiap alat — kalibrasi, perbaikan, hingga penghapusan — tercatat dan dapat diaudit." | "Each device's history — calibrations, repairs, retirement — recorded and auditable." |
| F4 | "Scheduling that stays ahead" / "Interval-based due dates, technician assignment, and escalations before a device slips out of tolerance." | OC | as W4 | "Tanggal jatuh tempo berbasis interval dan perintah kerja otomatis untuk alat yang jatuh tempo." | "Interval-based due dates and automatic work orders for devices that fall due." |
| F5 | "Certificates auditors accept" / "Traceable measurement chains and signed, tamper-evident certificates generated automatically." | OP + OC ("chains") | as H2, W6 | "Sertifikat yang dapat diverifikasi" / "Sertifikat bertanda tangan elektronik dengan kode QR dan hash integritas." | "Verifiable certificates" / "Electronically signed certificates with a QR code and an integrity hash." |
| F6 | "Notifications that matter" / "Targeted reminders for due, overdue, and failed calibrations — to the people who own the device." | OC ("to the people who own the device") | notifications are tenant-wide (W4); there is no device owner | "Pengingat untuk kalibrasi yang jatuh tempo dan terlambat, di aplikasi dan secara real time." | "Reminders for due and overdue calibrations, in-app and in real time." |
| F7 | "Multi-tenant by design" / "Isolate facilities and regions, each with its own branding, roles, and data — from one console." | OC ("regions") | tenant isolation by global Sequelize hooks (CLAUDE.md), per-tenant branding, tenant hierarchy (`routes/api/tenantHierarchy.route.js`). No regional deployment | "Setiap fasilitas terpisah datanya, dengan peran, pengguna, dan branding masing-masing." | "Each facility's data kept separate, with its own roles, users and branding." |
| F8 | "Reporting leadership reads" / "Compliance rates, workload, and cost trends in dashboards you can export for the board." | V/partly | reports: summary, compliance, workload, overdue, inventory, CSV via `?format=csv` (`reports.route.js:31-97`, `reporting.controller.js:6-11`). "Cost trends" not verified as a report | "Laporan kepatuhan, beban kerja, dan alat terlambat — dapat diekspor ke CSV." | "Compliance, workload and overdue-device reports — exportable to CSV." |
| F9 | Photo cell "Monitoring" / "Live device status across the whole fleet" over a **patient vital-signs monitor** photo | misleading | the product holds no patient data (Non-Goals) | replace image with product UI (device status list) | same |
| F10 | "Inside tolerance, on time." / "Every device, every interval — tracked so nothing drifts unnoticed." | OP ("nothing") | — | "Setiap alat, setiap interval — terpantau." | "Every device, every interval — tracked." |

### 3.7 Platform (`PlatformSection.tsx`, `data/landing.ts` `platformCapabilities`)

| # | Verbatim | Class | Evidence | Proposed ID | Proposed EN |
|---|---|---|---|---|---|
| P1 | Browser chrome "app.hdc.health / dashboard" over `platform-dashboard.jpg` (Pexels: "graph on laptop screen") | **OC (stock photo presented as the product, invented domain)** | `CREDITS.md` | real screenshot, real or neutral URL | same |
| P2 | "One console for every facility you run." | V | — | "Satu sistem untuk semua fasilitas Anda." | "One system for all your facilities." |
| P3 | "Past the calibration basics, HDC gives leadership the visibility and the plumbing to run device compliance at scale." | V + OP ("at scale") | U-06: performance targets not met above low concurrency | "Di luar kalibrasi, manajemen mendapat gambaran status alat di seluruh fasilitas." | "Beyond calibration, leadership sees device status across every facility." |
| P4 | "Digital certificates & records" / "Signed PDFs and a full measurement trail, retained and searchable for the life of every device." | OP ("for the life of every device") | append-only records (ADR-062), retention policies (`routes/api/dataRetention…`) | "Sertifikat dan catatan kalibrasi disimpan sesuai kebijakan retensi Anda." | "Certificates and calibration records kept under your retention policy." |
| P5 | "Real-time device status" / "See what's due, overdue, and out of service across the whole fleet at a glance." | OK | dashboard + Socket.IO (ADR-031) | "Status alat real time: jatuh tempo, terlambat, tidak beroperasi." | keep |
| P6 | "Multi-region ready" / "Run several facilities or countries with data residency and per-tenant configuration." | **OC** | `enable_data_residency` feature flag **defaults to false** (`featureFlag.service.js:28`); per-tenant object storage bucket exists (storage module); the database is one deployment | remove, or "Penyimpanan berkas per tenant, termasuk bucket milik Anda sendiri." | remove, or "Per-tenant file storage, including your own bucket." |
| P7 | "API-first architecture" / "Connect your CMMS, LIS, or asset register — calibration data flows where you need it." | OC (no connectors) | API keys (`apiKeys.route.js`), webhooks (`webhooks.route.js`), OIDC provider | "REST API dengan API key dan webhook untuk integrasi dengan sistem Anda." | "A REST API with API keys and webhooks for integrating your own systems." |
| P8 | Chips "In tolerance" / "Due soon" | OK if they match the screenshot | — | "Sesuai" / "Segera jatuh tempo" | keep |

### 3.8 Compliance (`ComplianceSection.tsx`, `data/landing.ts` `accreditations`, `complianceChecklist`)

| # | Verbatim | Class | Evidence | Proposed ID | Proposed EN |
|---|---|---|---|---|---|
| C1 | "Walk into the audit already prepared." | OP | — | "Bukti audit terkumpul saat pekerjaan dilakukan." | "Audit evidence collected as the work happens." |
| C2 | "Every record is traceable, signed, and time-stamped as work happens — so an inspection is an export, not a fire drill." | OC ("every record … signed") + OP | only certificates / e-signature requests are signed; every mutation is audit-logged with actor and time | "Setiap perubahan tercatat di jejak audit dengan pelaku, waktu, dan nilai sebelum/sesudah; sertifikat ditandatangani secara elektronik." | "Every change is recorded in the audit trail with who, when, and before/after values; certificates are signed electronically." |
| C3 | "Unbroken measurement traceability chain" | **OC** | as H2 | "Standar acuan dan ketidakpastian dicatat pada setiap hasil kalibrasi" | "Reference standard and uncertainty recorded on every calibration result" |
| C4 | "Automatic calibration due & overdue tracking" | OK | scheduler | "Pelacakan otomatis alat jatuh tempo dan terlambat" | keep |
| C5 | "Digital certificate signing and validation" | OK | e-signature + public verify | "Tanda tangan elektronik dan verifikasi sertifikat" | "Electronic signing and certificate verification" |
| C6 | "Complete, immutable audit history" | OP ("complete") | `audit_logs` has `REVOKE UPDATE, DELETE` (DECISIONS l.1021). Not complete: failed sign-ins write no audit row (A-72), successful SCIM mutations write none (A-37, DECISIONS l.4096) | "Jejak audit append-only (tidak dapat diubah atau dihapus oleh aplikasi)" | "Append-only audit trail (the application cannot edit or delete it)" |
| C7 | "Role-based access and approval workflows" | OK | RBAC + `dynamicAccess`, workflows route | "Hak akses berbasis peran dan alur persetujuan" | keep |
| C8 | "One-click export for auditors and surveys" | OC/V | CSV report export exists; no packaged survey evidence export | "Ekspor laporan ke CSV" | "Report export to CSV" |
| C9 | Floating card "Audit prep: Days → minutes" | **OC (unsourced)** | — | remove | remove |
| C10 | Card "ISO 17025 — Testing & calibration competence — Traceability and uncertainty handled the way assessors expect." | OP | uncertainty budget JSON on device, uncertainty on record (migration `0009`) | "ISO/IEC 17025 — Mendukung pencatatan ketidakpastian dan standar acuan yang diperiksa asesor." | "ISO/IEC 17025 — Supports recording the uncertainty and reference standards assessors review." |
| C11 | Card "KARS — Hospital accreditation (ID) — Evidence packaged for Indonesian hospital accreditation surveys." | **OC** | KARS appears only as an example value in a certificate `standard` column comment (`models/certificate.model.ts:219`) | "Akreditasi rumah sakit — Riwayat kalibrasi dan pemeliharaan alat yang dapat ditunjukkan saat survei." | "Hospital accreditation — Device calibration and maintenance history you can show during a survey." |
| C12 | Card "SNARS — National accreditation standard — Device-safety records mapped to SNARS requirements." | **OC** (no mapping) + likely outdated name (§3.1) | as C11 | merge into C11 | merge into C11 |
| C13 | Card "HIPAA — Data privacy & security — Access controls and audit logs that protect sensitive records." | **OC, irrelevant** | no patient data; HIPAA is a US law | replace with "21 CFR Part 11 — Tanda tangan elektronik dengan autentikasi ulang dan jejak audit." | "21 CFR Part 11 — Electronic signatures with re-authentication and an audit trail." |
| C14 | Section framing (implied) | — | owner brief | add a line: "Callibrator bukan lembaga sertifikasi dan tidak bersertifikat atas standar ini; platform ini membantu Anda menyiapkan bukti." | "Callibrator is not a certification body and is not itself certified against these standards; it helps you prepare the evidence." |

### 3.9 Testimonials (`TestimonialsSection.tsx`, `data/landing.ts` `testimonials`)

All **OC (fabricated)**; remove the section (owner brief).

| # | Verbatim |
|---|---|
| Q1 | "In their words" / "What teams say after they make the switch." |
| Q2 | "We used to lose a full week to audit prep. Now the certificates are already signed and filed — I export them in an afternoon and our assessor barely has a question." — "Dr. Sarah Chen, Chief Biomedical Engineer, Meridian Health System" |
| Q3 | "Nothing falls through the cracks anymore. The schedule tells my team what's due before it's due, and overdue devices are impossible to ignore." — "James Okafor, Calibration Lead, St. Aubyn Medical Center" |
| Q4 | "Rolling it out across four hospitals took days, not months. Each site keeps its own data and branding but we finally report on all of it together." — "Dr. Aisha Rahman, Director of Quality, Northgate Hospitals" |
| Q5 | "Recording readings at the bench on a tablet — and getting the pass/fail instantly — changed how our technicians actually work." — "Marco Silva, Biomedical Technician, Valley Regional" (also repeats the W5 over-claim) |
| Q6 | Star rating `aria-label="5 out of 5"` on each |

Faces are randomuser.me portraits of real people used to endorse a product they never saw (§4).

### 3.10 Pricing and CTA (`PricingSection.tsx`, `CtaSection.tsx`, `data/landing.ts` `pricingTiers`)

Owner decision: pricing is not shown. Everything in `PricingSection` is removed; recorded here because it is live today.

| # | Verbatim | Class | Evidence |
|---|---|---|---|
| R1 | "Plans that scale with your fleet." / "Start with a 14-day free trial — no credit card. Move up as you add devices and facilities." | **OC** | no trial path; tenant plans ENUM `free/professional/business/enterprise` (`tenant.model.ts:41`) does not match "Starter/Professional/Enterprise" |
| R2 | Tier features: "Up to 100 devices · 1 facility · Scheduling & reminders · Digital certificates · Email support" / "Up to 1,000 devices · 5 facilities · SSO & role-based access · Advanced analytics · API access · Priority support" / "Unlimited devices · Unlimited facilities · Multi-region & data residency · Dedicated success manager · On-premise option · Custom integrations" | OC (limits, services, multi-region) | device quotas per tier not verified; support and success management are commitments, not code; on-premise: compose deploy works (U-01a), Helm not known to deploy (U-01) |
| R3 | "Most popular" | **OC** | no data |
| R4 | "Need something bigger? Talk to our team about network-wide deployments." → `/login` | wrong link | — |

| # | Verbatim | Class | Proposed ID | Proposed EN |
|---|---|---|---|---|
| X1 | "Start today" / "Make your next audit the boring one." | V (tone OK) | "Mulai percakapan" / "Siapkan audit berikutnya dengan bukti yang sudah tercatat." | "Start a conversation" / "Prepare your next audit with evidence already on record." |
| X2 | "Bring every device, schedule, and certificate into one place — and hand your assessors a folder that's already complete." | OP ("already complete") | "Satukan alat, jadwal, dan sertifikat dalam satu sistem. Ceritakan kebutuhan institusi Anda — tim kami akan menghubungi Anda." | "Bring devices, schedules and certificates into one system. Tell us what your institution needs — our team will get in touch." |
| X3 | Buttons "Start free trial" (→ `/login`), "Book a walkthrough" (→ `/login`) | **OC**, wrong links | "Hubungi via WhatsApp" · "Ajukan akses" | "Chat on WhatsApp" · "Request access" |
| X4 | Ticks "No credit card required · 14-day free trial · Cancel anytime" | **OC** | remove | remove |

### 3.11 Unused but shipped in the repository: `SecuritySection.tsx`

Not imported by any page, but it is the section most likely to be "brought back" in a revamp. **Recommend deleting the file.**

| # | Verbatim | Class | Evidence |
|---|---|---|---|
| S1 | "End-to-End Encryption — All data encrypted at rest and in transit using AES-256 encryption. TLS 1.3 ensures secure communication between all system components and user sessions." | **OC** | AES-256 covers tenant e-signature private keys under a KMS envelope (`migrations/0058-tenant-keys-kms-envelope.js`, `kms.service.js`), not "all data"; TLS terminates at the edge (Cloudflare tunnel / nginx, MEMORY vm-deployment); "TLS 1.3" appears nowhere in the repo; "end-to-end" is false |
| S2 | "military-grade encryption and industry best practices" / "Your patient and device data is protected" | **OC** | no patient data (Non-Goals) |
| S3 | "OIDC Authentication & MFA — Industry-standard OpenID Connect … SSO integration with existing identity providers" | OK | SAML + OIDC SSO, TOTP MFA exist |
| S4 | "Multi-Tenant Isolation — Strict data isolation between tenants at the database level. … no cross-contamination risk." | **OC + OP** | isolation is application-level Sequelize hooks; RLS was removed (MEMORY realtime/RLS note); "raw SQL bypasses the hooks" (CLAUDE.md) |
| S5 | "Complete Audit Trail — Every action logged with before/after state tracking, user attribution, timestamps, and IP addresses. Immutable audit logs meeting regulatory retention requirements." | OP | see C6 |
| S6 | "Automated Backups & DR — Daily encrypted backups with 30-day retention and cross-region replication. Point-in-time recovery capabilities and quarterly disaster recovery drills" | **OC** | per-tenant scheduled backups with `BACKUP_RETENTION_DAYS=30` exist (`docs/DEVOPS/04-DATABASE-BACKUP.md`); no cross-region replication, no WAL/PITR ("RPO: no, as shipped", DR doc l.11), one drill (P7-04), backups "assumed, not known" (U-05) |
| S7 | "Real-Time Monitoring — Comprehensive monitoring with Slack/PagerDuty integrations" | OC (PagerDuty) | alerts go to a generic `ALERT_WEBHOOK_URL` (Slack/Mattermost-compatible) and email (`services/alert.service.js:12-17`); no PagerDuty |
| S8 | "Enterprise-Grade Security & Compliance" / "Built from the ground up with security and compliance as first class citizens." | V | — |

### 3.12 Auth pages

| # | Location | Verbatim | Class | Proposed ID | Proposed EN |
|---|---|---|---|---|---|
| A1 | `AuthBrandingPanel.tsx` eyebrow | "Calibration, documented" | OK | "Kalibrasi, terdokumentasi" | keep |
| A2 | `AuthBrandingPanel.tsx` default tagline | "Keep every medical device calibrated, compliant, and audit-ready — all from one platform." | OP (the platform does not calibrate or make compliant) | "Catatan kalibrasi, pemeliharaan, dan sertifikat alat kesehatan dalam satu sistem." | "Calibration, maintenance and certificate records for medical devices, in one system." |
| A3 | `AuthBrandingPanel.tsx` trust points | "ISO 17025-aligned workflows" · "Signed, audit-ready certificates" · "HIPAA-ready access controls" | 1: V/OK with "supports"; 2: V; 3: **OC** | "Mendukung alur kerja ISO/IEC 17025" · "Sertifikat bertanda tangan elektronik" · "MFA, SSO, dan passkey" (passkey only once §5.4 ships) | "Supports ISO/IEC 17025 workflows" · "Electronically signed certificates" · "MFA, SSO and passkeys" |
| A4 | `register/page.tsx` tagline | "Create your workspace and start managing medical device calibration — compliant from day one." | **OC** (no workspace is created; "compliant from day one") | request-access copy: "Ajukan akses untuk institusi Anda. Tim kami meninjau setiap permintaan." | "Request access for your institution. Our team reviews every request." |
| A5 | `login/page.tsx` | "Return to Home" | OK | "Kembali ke beranda" | "Back to home" |
| A6 | `login/page.tsx` | "Sign in" (eyebrow) / "Welcome back" / "Sign in to your account to continue" | OK | "Masuk" / "Selamat datang kembali" / "Masuk ke akun Anda untuk melanjutkan" | keep |
| A7 | `login/page.tsx` tabs | "Password Login" / "Enterprise SSO" | OK (jargon) | "Email & kata sandi" / "SSO organisasi" | "Email & password" / "Organisation SSO" |
| A8 | `login/page.tsx` | "New to the platform? **Create a tenant workspace**" | **OC** (register creates a tenantless user, ADR-075) | "Institusi Anda belum terdaftar? **Ajukan akses**" | "Institution not on Callibrator yet? **Request access**" |
| A9 | `PasswordLoginForm.tsx` | "Email or Username" · placeholder "you@hospital.com" · "Password" · "Remember me" · "Sign In" / "Signing In..." | "Remember me": **OC (dead control)**, it has no state and changes nothing; rest OK | "Email atau nama pengguna" · "nama@rumahsakit.co.id" · "Kata sandi" · (remove "Ingat saya" unless wired) · "Masuk" / "Sedang masuk…" | keep, remove "Remember me" |
| A10 | `PasswordLoginForm.tsx` show/hide | aria "Show password" / "Hide password" | OK | "Tampilkan kata sandi" / "Sembunyikan kata sandi" | keep |
| A11 | `MfaLoginForm.tsx` | "Two-factor authentication is enabled. Enter the 6-digit code from your authenticator app." / "Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once." / "Authentication code" / "Recovery code" / "Verify & Sign In" / "Lost your authenticator? Use a recovery code" / "Use a code from my authenticator app" / "Back to sign in" | OK | "Masukkan 6 digit kode dari aplikasi autentikator Anda." / "Masukkan salah satu kode pemulihan yang Anda simpan saat mengaktifkan verifikasi dua langkah. Setiap kode hanya berlaku sekali." / "Kode autentikasi" / "Kode pemulihan" / "Verifikasi & masuk" / "Kehilangan autentikator? Gunakan kode pemulihan" / "Gunakan kode dari aplikasi autentikator" / "Kembali ke halaman masuk" | keep |
| A12 | `SsoLoginForm.tsx` | "Protocol" SAML/OIDC · "Tenant Code" · placeholder "e.g. hca-group" · "Continue with SAML/OIDC" · "Redirecting to IdP..." | V/jargon; the placeholder names a real hospital company (HCA Healthcare) | "Kode organisasi" · "contoh: rs-sehat" · "Lanjutkan dengan SSO" · "Mengalihkan ke penyedia identitas…" (hide the protocol choice if the tenant's configuration can decide it, see §5.3) | "Organisation code" · "e.g. rs-sehat" · "Continue with SSO" · "Redirecting to your identity provider…" |
| A13 | `useLoginForm.ts` SSO errors | "Your single sign-on attempt expired or was started in another browser. Please start again." · "Single sign-on is not available for this organisation." · "Your account may not sign in through single sign-on. Contact your administrator." · "Single sign-on did not complete. Please try again, or contact your administrator." · "Single sign-on is temporarily unavailable. Please try again later." | OK (good: fixed messages, the query string is never rendered) | translate 1:1 | keep |
| A14 | backend messages rendered raw | "Invalid credentials" · "Too many failed sign-in attempts. Wait a few minutes, then try again." · "Account is suspended" · "Account temporarily locked" · tenant refusals | OK in content, English only | map by status code to ID/EN strings in the frontend | — |
| A15 | `RegisterInputs` / `register/page.tsx` | "Get started" / "Create your account" / "Register to start managing medical calibrations" / "Creating Account..." / "Already have an account? Sign In" | **OC** ("start managing": the account sees nothing) | replaced by request access (§6) | — |
| A16 | `useRegisterForm.ts` | "First name must be at least 2 characters" / "Username must be at least 3 alphanumeric characters" / "Password must be at least 8 characters and contain uppercase, lowercase, and a number" / toast "Registration successful!" "Please check your email to activate your account." | OK as validation copy; flow is wrong | — | — |
| A17 | `RegisterSuccessPanel.tsx` | "Check your email" / "We have sent an activation link to {email}. Please check your inbox and click the link to verify your account." / "Proceed to Sign In" | misleading by omission (the account will have no tenant) | request-access success: "Permintaan Anda sudah kami terima. Kami akan menghubungi {email} setelah ditinjau." | "We've received your request. We'll contact {email} once it has been reviewed." |
| A18 | `activation/page.tsx` | "Verifying your email address" / "One moment…" / "Email address verified" / "Your address is confirmed. You can sign in, and password resets will be sent to it." / "Verification failed" / "This activation link is incomplete. Open the link from your email again." / "Go to sign in" / "Back to sign in" | OK | translate | keep |
| A19 | `sso-callback/page.tsx` | "SSO Authentication" / "Verifying secure single sign-on response..." / "Success" / "Successfully authenticated. Redirecting to dashboard..." / "Authentication Error" / "SSO Authentication failed: code query parameter is missing." / "Back to Login" | V ("secure"), the missing-code message is developer-speak | "Menyelesaikan proses masuk…" / "Tautan masuk tidak lengkap. Silakan mulai lagi dari halaman masuk." | "Finishing sign-in…" / "The sign-in link is incomplete. Please start again from the sign-in page." |
| A20 | `oauth/consent/page.tsx` | "Authorize access" / "…wants to access your account. It will be able to:" / "You'll be redirected to {redirectUri}" / "Deny" / "Allow" | OK | translate | keep |

### 3.13 Public certificate verification (`verify/[certificateNumber]/page.tsx`)

| # | Verbatim | Class | Proposed ID | Proposed EN |
|---|---|---|---|---|
| V1 | "Certificate verification" (eyebrow) / `<h1>` = the certificate number | OK | "Verifikasi sertifikat" | keep |
| V2 | "Certificate not found" / "No certificate matches this number. It may be mistyped or invalid." | OK | "Sertifikat tidak ditemukan" / "Tidak ada sertifikat dengan nomor ini. Periksa kembali nomornya." | keep |
| V3 | "Certificate is valid" / "This certificate is authentic, signed, and currently in force." | V ("authentic" = matches the issuer's records; the page cannot vouch for the paper in hand) | "Sertifikat berlaku" / "Sertifikat ini tercatat pada sistem penerbit, telah ditandatangani, dan masih berlaku." | "Certificate is valid" / "This certificate is on the issuer's records, signed, and currently in force." |
| V4 | "Certificate revoked" / "…revoked by the issuer and is no longer valid." · "Certificate withdrawn" / "…withdrawn by the issuer…" · "Certificate expired" / "This certificate is authentic but has passed its validity date." · "Not yet valid" / "This certificate is not signed (status: …)." | OK (status leaks the internal word, e.g. `draft`) | translate; map `status` to a label | keep, map status |
| V5 | Row labels "Certificate no. · Status · Type · Standard · Issued to · Device · Issue date · Valid until · Signed by · Signed at · Integrity hash (SHA-256, …)" / "Integrity hash on documents issued before 29 Sep 2026 (SHA-256)" | OK | translate | keep |
| V6 | "Certificate document" / "Generated from the issuer's records. It prints the integrity hash shown above." / "Download certificate PDF" / "The PDF could not be generated. Please try again." / "Document stored at issue" / "Open PDF" | OK | translate | keep |
| V7 | "Verified against the issuer's records in real time. Cross-check the certificate number matches the printed document." | OK (good, honest) | "Diverifikasi langsung terhadap catatan penerbit. Pastikan nomor sertifikat sama dengan dokumen cetak." | keep |
| V8 | Network error "Network error while verifying the certificate." / fallback "Unable to verify this certificate." | OK | translate | keep |

### 3.14 Verifiable facts available for the revamp (replacement "social proof")

Each is backed by code or a recorded decision. Quote them as capabilities, not outcomes.

| Fact | Evidence |
|---|---|
| Audit trail is append-only: the application role cannot update or delete `audit_logs` | DECISIONS l.1021 (`REVOKE UPDATE, DELETE` on `calibration_records` and `audit_logs`) |
| Calibration records are append-only; corrections and voids are new records with a reason | `models/calibrationRecord.model.ts` (`supersedesId`, `correctionReason`, `voidReason`), ADR-062, migration `0057` (DECISIONS l.2497) |
| Every mutation writes an audit row with before/after, actor, IP, user agent | `docs/PLAN/00-PROJECT-OVERVIEW.md` § Solution; CLAUDE.md non-negotiables |
| Electronic signatures with re-authentication (21 CFR Part 11 style) | `routes/api/eSignature.route.js`, `controllers/eSignature.controller.js` |
| Certificates carry a QR code and a SHA-256 integrity hash, verifiable publicly without an account | `certificates.route.js:38`, verify page |
| TOTP two-factor sign-in with one-time recovery codes | `auth.route.js:857-1034` |
| SSO through SAML 2.0 and OpenID Connect; SCIM provisioning | `auth.route.js:568-769`, `routes/api/scim.route.js` |
| Passkey (WebAuthn) enrolment, used for step-up | `webauthn.route.js` (sign-in with a passkey: not yet, §5.4) |
| Tenant data separated by default-deny scoping; cross-tenant access answers 404 | CLAUDE.md, ADR-048; `twoTenantRoutes.guard.test.ts` covers 201 `:id` routes |
| Measurement uncertainty and uncertainty budgets | migration `0009-add-uncertainty-budgets.js` |
| Automatic work orders and notifications for due and overdue devices | `services/calibrationScheduler.service.js` |
| CSV device import; CSV report export | `calibrationDevices.route.js:444`; `reporting.controller.js:6-11` |
| REST API with API keys and webhooks | `apiKeys.route.js`, `webhooks.route.js` |
| Per-tenant branding (logo, name, colour) | `tenants/public`, `TenantBrandingProvider` |
| Self-hostable (Docker Compose deployment running) | BACKLOG U-01a (Helm: renders, not known to deploy) |
| QMS: non-conformances, CAPA, SOPs, risk register | `qms.route.js`, `sop.route.js`, `risk.route.js` |

---

## 4. Assets in Use

| Asset | Where used | Source | Licence | Risk |
|---|---|---|---|---|
| `public/marketing/step-register.jpg`, `step-schedule.jpg`, `step-calibrate.jpg` (also the hero), `step-certify.jpg`, `compliance-audit.jpg`, `feature-monitoring.jpg`, `platform-dashboard.jpg`, `cta-band.jpg`, `hero-clinician.jpg` (auth panel) | landing sections, auth panel | Pexels, URLs in `public/marketing/CREDITS.md` | Pexels License: commercial use allowed, no attribution. It **prohibits** implying that identifiable people endorse a product, and portraying them in a misleading way | **medium**: the licence is fine, the use is not. `platform-dashboard.jpg` is presented as the product (P1); `feature-monitoring.jpg` shows patient vital signs (F9). Owner brief replaces hero imagery with real screenshots; Pexels photos can stay only as mood images, never as "product" |
| `public/marketing/avatar-1..4.jpg` | hero avatar stack, testimonials | randomuser.me (`portraits/men/32, women/44, men/76, women/68`) | **unclear for commercial marketing.** randomuser.me provides portraits for placeholder/test data; it does not grant a model release for advertising. They are real people's faces attached to invented names, quotes and ratings | **high: remove.** Using a real person's likeness as a fake testimonial is a likeness/misrepresentation problem regardless of the image licence |
| `public/brand/*.svg`, `logo-email.png`, `app-icon.svg`, `favicon.ico`, `apple-touch-icon.png`; inline `components/brand/BrandIcon.tsx` | nav, auth, favicon | in-house (navy `#001250`, teal `#00DAB4`); no credits file | presumably owned; **no licence or origin record** | low: record the origin (designer, date) in a credits file. SVG `<title>` says "Device Calibrator" (naming, Q-1). Note the brand teal `#00DAB4` already matches the owner's "electric teal/cyan" accent |
| `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | **unused** (Next starter leftovers) | Next.js template | MIT (template) | low: delete |
| Fonts: Inter, JetBrains Mono, Space Grotesk | all pages (`app/layout.tsx`) | `next/font/google`: downloaded **at build time** and served from `/_next/static/media` (16 `.woff2` in the build; `font-src 'self'`) | SIL OFL 1.1 (all three) | low. Build needs network access to Google Fonts; an air-gapped build fails. `next/font/local` with committed files removes that dependency |
| Icons: `lucide-react` ^1.48 | everywhere | npm | ISC | none |
| Motion: `gsap` ^3.15 (+ `@gsap/react`), `ScrollTrigger`, `SplitText` | landing | npm | **"Standard 'no charge' license"** (`node_modules/gsap/package.json`: https://gsap.com/standard-license), not an OSI licence. Commercial use is free; it restricts use in products that compete with Webflow's visual builder | low for this product, but it is the one non-OSI licence on the page; record it |
| `motion` ^13 (Framer Motion), `lenis` ^1.3 | landing, auth | npm | MIT | none |
| `jspdf` ^4 | verify page (lazy) | npm | MIT | none |

**Owner rule "licence recorded per asset":** today only the photos and avatars are recorded, in `CREDITS.md`, which itself says "placeholder". Proposal: one `public/CREDITS.md` (or `docs/UI-UX/ASSETS.md`) table for every image, font and icon set, with source URL, licence, date and the person who approved it.

---

## 5. Auth Pages: UX, Accessibility, Security

### 5.1 Login (`app/login/*`)

| Finding | Evidence | Severity | Recommendation |
|---|---|---|---|
| Generic "Invalid credentials" for unknown user and wrong password, with a dummy hash compare for unknown users; suspension/lock/tenant state disclosed only after a correct password | `services/auth.service.js:437-512` (`UNKNOWN_ACCOUNT_HASH`, A-83, A-215) | good | keep |
| Throttle: 5 failures per identifier+address per 15 min, 100 per identifier per hour | `constants/rateLimitConstants.ts:46-63` (A-185) | good | show the backend's 429 text with a countdown from `retryAfter` (present in the 429 body, `rateLimiter.redis.service.js` authPreCheck) — today the raw message is shown with no timer |
| "Remember me" checkbox is **not wired** (no state, not sent) | `PasswordLoginForm.tsx` | medium (a control that lies) | remove it, or implement a longer refresh-token lifetime behind an explicit decision |
| No `autocomplete` tokens (`username`, `current-password`) | `PasswordLoginForm.tsx` inputs | medium (WCAG 1.3.5 Identify Input Purpose; password managers) | add `autocomplete="username"` and `"current-password"`; `webauthn` in the username token once passkeys ship (conditional UI) |
| **No "Forgot password?" link and no page** | §2.2 | high | add `/forgot-password` (email → OTP) and reset (OTP + new password); both endpoints exist and answer generically |
| Error banner has no `role="alert"` / live region | `login/page.tsx` error div | medium (WCAG 4.1.3) | `role="alert"`; move focus to the banner or to the first invalid field |
| Method tabs are plain `<button>`s; the selected one is shown only visually (a Motion indicator) | `login/page.tsx` | medium (WCAG 4.1.2) | real tabs (`role="tablist"`, `aria-selected`, arrow keys) or a segmented control with `aria-pressed` |
| Two `<h1>` elements in the DOM (mobile `lg:hidden` block and `AuthBrandingPanel`); only one is displayed at a time | `login/page.tsx`, `AuthBrandingPanel.tsx`; same on register | low (display:none removes it from the a11y tree) but it fights ADR-090's "one `<h1>`" guard | one `<h1>` in the form column ("Masuk ke Callibrator"); the panel's brand name becomes a `<p>` |
| Form title "Welcome back" is an `<h2>` while the brand name is the `<h1>` | same | low | the page's purpose should be the `<h1>` |
| Page is a client component inside `Suspense` with a spinner fallback | `login/page.tsx` | low (LCP) | render the static shell on the server; only the form is a client island |
| After sign-in, `mustChangePassword` and `mfaEnrolmentRequired` are routed correctly for password sign-in | `useLoginForm.ts` `destinationAfterSignIn` | good | apply the same routing in `/sso-callback`, which always pushes `/dashboard` and ignores `callbackUrl` |
| `callbackUrl` restricted to a same-origin path (F-60) | `lib/safeCallback` | good | keep |

### 5.2 MFA (TOTP) step

Good as built: 6-digit numeric input with `inputMode="numeric"` and `autocomplete="one-time-code"`, recovery-code mode with formatting (`XXXX-XXXX-XXXX-XXXX`), submit disabled until complete, back link resets state, per-user (5/15 min), per-token (3) and optional per-IP limits (`auth.route.js` swagger for `/mfa/login`, A-81/A-141). Gaps: the instruction box is not associated with the input (`aria-describedby`); errors show in the page banner without `role="alert"`; no "code expired / start again" message when the temporary MFA token lapses (the 401 text is shown raw). Enrolment (`/dashboard/mfa`) exists and is out of scope here.

### 5.3 SSO

| Finding | Evidence | Severity | Recommendation |
|---|---|---|---|
| The user must know a **tenant code** and choose **SAML or OIDC** themselves | `SsoLoginForm.tsx` | medium (UX): clinicians do not know either | ask for the organisation code only (or derive it from the email domain / a tenant subdomain) and let the backend pick the configured protocol. That needs one backend change: a single `POST /auth/sso/start` that reads the tenant's configured protocol |
| **Tenant-code oracle and configuration disclosure:** unknown code → `404 Tenant not found`; known code without SSO → `400 SSO is not enabled for this tenant` / `SSO entry point is not configured` / `OIDC is not configured` | `controllers/sso.controller.js:316-333, 488-505` | medium (lets anyone enumerate customer codes and see which have SSO) | one generic answer for all four ("SSO is not available for this organisation code"), logged with the real reason |
| `/sso/login` and `/sso/oidc/login` have **no auth pre-check limiter**; only the global limiter (5000 / 15 min / IP in production) | `auth.route.js:568,648`; `index.js:212` | medium | put them behind `endpointRateLimiter` |
| Callback errors return to `/login?error=<code>` with fixed messages only | `useLoginForm.ts` A-188 | good | keep |
| `/sso-callback` spends the one-time code once, strips it from history | `sso-callback/page.tsx` A-60 | good | keep; add `role="status"`/`aria-live` to the processing card; route through `destinationAfterSignIn` |

### 5.4 Passkey (WebAuthn)

**Today a passkey cannot sign anyone in.** `webauthn.route.js:13` applies `router.use(auth)` to every route, including `login-options` and `verify-login`; `verifyLogin` takes `req.user.id` and returns a verification result, not a session (`controllers/webauthn.controller.js:25-37`). The credential is one per user, stored on the user row (`webauthnCredentialId`, `services/webauthn.service.ts:195-201`), registered with `residentKey: "required"` and `userVerification: "required"` (`:126-127`), so discoverable, usernameless sign-in is **technically possible** with the credentials people already enrol.

To show "Sign in with a passkey" on the login page (owner decision), the backend needs:

1. `POST /auth/passkey/options` (public, rate-limited): a challenge with empty `allowCredentials`, stored in Redis keyed by a nonce.
2. `POST /auth/passkey/login` (public, rate-limited): verify the assertion, find the user by credential id **across tenants** (a `skipTenantScope` lookup, reviewed), apply the same refusals as password sign-in (suspended, locked, tenant state), then issue the session **and** the LOGIN audit row in one transaction (A-72), through the same Next route handler that sets cookies.
3. A decision (ADR) on whether a passkey sign-in satisfies MFA for accounts with TOTP enabled (a user-verifying passkey is itself multi-factor under NIST SP 800-63B AAL2/3) and whether platform operators (`mfaEnrolmentRequired`) may use it.
4. Frontend: `navigator.credentials.get` with `mediation: "conditional"` (autofill) plus an explicit button; handle `NotAllowedError` with the same plain messages the enrolment page already has (`dashboard/webauthn/page.tsx` `explain`).
5. Note from the DR document: a Redis outage makes passkey ceremonies fail (`docs/ARCHITECTURE/09-DISASTER-RECOVERY.md` l.54), so password sign-in must stay available.

Until that ships, the mockups should show the passkey button as **designed but disabled/hidden behind a flag**, not as a working feature.

### 5.5 Register: what the backend allows today

- `POST /api/v1/auth/register` accepts `firstName, lastName, username, email, password` (`validators/auth.validator.ts:31-38`) and creates a user with `roleId: ROLE_IDS.USER`, **no `tenantId`**, `isEmailVerified: false`, then mails an activation link (`services/auth.service.js:202-285`).
- ADR-075 (DECISIONS l.4062): such an account "carries no tenant and sees nothing". Sign-in does not require verification.
- **Account enumeration:** the endpoint answers `409 Email already registered` and `409 Username already used` (`auth.service.js:226,236`), the one unauthenticated oracle left among the auth endpoints.
- **Address squatting:** a self-registration holds its email against the **global** unique index and nothing expires it (DECISIONS l.4096-4098). Anyone can pre-register a hospital administrator's address and block the super admin from later creating that administrator.
- **Mail abuse:** the activation link's origin comes from the request's `Origin`/`Host` header (DECISIONS l.4099); and, by reading the limiter, the "3 per hour" register limit counts **failures only**, keyed by user or token (absent for an anonymous caller) and by IP only when `AUTH_RATE_LIMIT_BY_IP=true`, which is **off by default** (`backend/.env.example:227`, `rateLimiter.redis.service.js` `noteAuthFailure`). A successful registration is never counted. So in the default configuration, registrations (and activation emails to arbitrary addresses) are limited only by the global 5000 / 15 min / IP limiter. The dedicated `authLimiter`/`otpLimiter` in `index.js:226-248` are declared and **never mounted**. *This is a code reading; it was not exercised.*
- Frontend: client-side rules match the backend (8+ chars, upper, lower, digit; username 3+ alphanumeric); no `autocomplete` (`given-name`, `family-name`, `username`, `email`, `new-password`); a single error banner, not per-field errors with `aria-invalid`/`aria-describedby`; the success panel has an `<h2>` and **no `<h1>`** in its `<main>`.
- **The password rule itself** (composition rules, 8 minimum, no breached-password check) is the opposite of NIST SP 800-63B §5.1.1.2, which recommends length over composition and a blocklist check. Not a blocker for this revamp, but the new request-access flow should not add another password form at all (the approved admin sets a password from an invitation link).

**Recommendation for the revamp:** retire `/register` from the UI (redirect to `/request-access`), and decide separately (Q-3) whether to disable the public register endpoint, which removes the enumeration oracle, the squatting and the mail-abuse surface in one step.

### 5.6 Forgot / reset password

Backend is sound: `send-otp` always answers "If the account exists, OTP has been sent" (`auth.controller.js:131-138`); a 6-digit OTP from `crypto.randomInt`, stored as SHA-256, valid 5 minutes (`auth.service.js:678-710`); reset answers "Invalid OTP" for an unknown email or a wrong code, and changes the password, revokes all sessions and writes the audit row in one transaction (`:723-775`). Same limiter caveat as §5.5: send-OTP successes are never counted, so a known address can be sent OTP emails repeatedly (`otpRequestCount` is incremented but not checked). The page design should: say "if an account exists for this address, we've sent a code" regardless; show the password rule before typing; offer "resend code" with a visible cooldown; and after success, send the user to sign in with a confirmation.

### 5.7 Enumeration matrix (unauthenticated endpoints on these pages)

| Endpoint | Reveals account/tenant existence? |
|---|---|
| `POST /auth/login` | no (A-185, dummy hash) |
| `POST /auth/mfa/login` | no (needs a token from a correct password) |
| `POST /auth/send-otp` | no (constant message; small timing difference from the DB write and mail queue) |
| `POST /auth/reset-password` | no ("Invalid OTP" for both) |
| `GET /auth/activation` | no (needs a valid signed token) |
| `POST /auth/register` | **yes** (409 email / 409 username) |
| `POST /auth/sso/login`, `/sso/oidc/login` | **yes, tenant codes** and SSO configuration (§5.3) |
| `GET /certificates/verify/:number` | by design it reveals a certificate; the risk is **enumeration** (§5.9) |
| `GET /tenants/public` | tenant branding by id or code (404 for unknown), by design for branded frontends |

### 5.8 Keyboard, focus, contrast, mobile (from the code; not driven in a browser)

- **Opacity on text** (ADR-090 forbids it): `TrustSection` marquee `text-muted-foreground/60`; `HowItWorksSection` step numbers `text-primary/25`; `AuthBrandingPanel` copyright `text-white/50`, eyebrow `text-white/70`; `CtaSection` `text-white/70`, `/80`. Gradient-clipped text in the hero `<h1>` (`bg-clip-text text-transparent`) has no measurable contrast for axe and fails in forced-colours mode.
- **Hard-coded colours** outside the tokens: `text-[#001250]` on the nav and auth brand mark, `bg-slate-950/80`, `bg-white text-slate-900`, `text-white` across CTA, feature photo cell and auth panel. The dark cinematic revamp should define these as tokens (e.g. `--surface-inverse`) so ADR-090's test can hold them.
- **Tenant branding overrides `--primary`** on the auth pages (`TenantBrandingProvider`, `AuthBrandingPanel` comment). A tenant colour that fails 4.5:1 on the new near-black surface will break the login button. The revamp needs a contrast guard (or a fixed platform accent on the public pages).
- **Motion:** `useReducedMotionSafe` disables Lenis, GSAP, Motion transitions, magnetic and tilt effects; CSS stops orbs, float, pulse, marquee, Ken Burns and sheen. Not stopped: `animate-ping` (hero live dot, infinite) and `animate-scale-in` / `fade-in-*` on auth cards. SSR assumes motion allowed, so a reduced-motion user gets one frame of the `hidden` state before hydration corrects it.
- **Mobile nav:** the menu button has `aria-expanded` and a label, but the open menu has no Escape handler, no focus management and is not closed on route change except by link clicks.
- **Landing landmarks:** one `<main>` (`LandingLayout`), one `<h1>` (hero). `Footer` uses `<h2>` for column titles, which puts four `<h2>`s after the last section; acceptable, but consider `<p>` or a `<nav aria-label>` per column.
- **Verify page:** verdict and loading state are not in a live region; heading order `<h1>` → `<h2>` (verdict) → `<h3>`, good; the iframe has a `title`, good.
- **Mobile layout:** the auth card is `mx-4` with `p-8`; the photographic panel is hidden below `lg`, so on phones the page is a plain form, which is right. The split-screen revamp should keep the visual panel desktop-only or reduce it to a short band.

### 5.9 Certificate enumeration (new finding, not recorded elsewhere)

Certificate numbers are sequential and predictable: `CERT-${YYYYMMDD}-${tenantCode}-NNNN` (`models/certificate.model.ts:286-315`). The public verify endpoint returns, for a found certificate, `issuedTo`, device name **and serial number**, `signedBy`, dates, and the document data (PDF rendered client-side). It sits behind only the global limiter. A script can walk a tenant's certificates day by day and collect its customer list, equipment inventory and signatories. A search of `TASKS/` and `MEMORY/DECISIONS.md` found no record of this. The revamp adds a lookup form to the landing page, which makes the path easier to find, so it should be decided before that ships: options are a dedicated rate limit on `/certificates/verify/*`, an unguessable verification token in the QR (the number stays printed; the URL carries the token), or reducing the public fields when the lookup did not come from a QR. **Needs an Open Question / ADR; not a copy decision.**

---

## 6. Backend Gap: "Request Access" + Super-Admin Approval Queue

### 6.1 What exists

| Capability | Where | Fit for the flow |
|---|---|---|
| Create a tenant (super admin only, rate-limited, audited under PLATFORM) | `POST /api/v1/tenants/create` (`tenant.route.js:376`), `services/tenant.service.js:439-570` | yes, reusable as the "approve" action's core. It creates the tenant **only**: no administrator, no email |
| Create a user in a tenant with a temporary password that must be changed on first sign-in, expiring (`TEMPORARY_PASSWORD_TTL_MS`) | `POST /api/v1/users` (`user.route.js`), `services/user.service.js:840-910` (A-123, A-215) | partly: the super admin must invent a password and send it out of band. An invitation link (set-your-password) would be better |
| Tenant lifecycle (suspend, resume, grace period, offboard, export) | `tenantLifecycle.route.js:38-206`, `admin.route.js:49-117` | adjacent. The "trial" state named in `tenantLifecycle.service.js:33-38` **does not exist** in the `status` ENUM (`active/suspended/deleted`) |
| Super-admin screens | `frontend/src/app/dashboard/tenants/` (`CreateTenantModal`, `EditTenantModal`, `SsoSettingsPanel`, `MfaPolicyPanel`…), `dashboard/tenant-lifecycle/` | the queue can live under `dashboard/tenants` as a tab |
| Purpose tokens (activation, MFA) | `generatePurposeToken`, `activationClaims` (`auth.service.js:262-265`) | reusable for an invitation token |
| Email queue + templates | `queueActivationEmail`, `queueOtpEmail`; `backend/src/templates/account.html`, `otp.html`, `template.html` | reusable; two new templates needed |
| Request-counting limiter keyed by IP | `endpointRateLimiter` (`rateLimiter.redis.service.js:584-640`): counts **every** request, per user/token/IP, answers 429 with `retryAfter`; fails open on Redis errors | yes. It depends on `req.ip` being the real client behind the proxy (A-16) |
| Alerts to operators | `services/alert.service.js` (webhook + email) | can notify the super admin of a new request |

**Nothing exists for requests themselves:** a search of `models`, `routes`, `controllers`, `services` for access-request, lead, onboarding, contact or demo-request found no match.

### 6.2 What must be added

**Model** `access_requests` (platform-owned, **not tenant-scoped**: it has no tenant until approved; mark the model and every query `skipTenantScope` with a reviewed reason, and exclude it from tenant backups):

| Column | Notes |
|---|---|
| `id` uuid | |
| `institution_name`, `institution_type` (hospital / calibration lab / other), `city`, `province`, `country` | |
| `contact_name`, `contact_email` (lower-cased), `contact_phone` (optional; WhatsApp), `job_title` | personal data: retention and a privacy notice are required (GDPR Art. 13, UU PDP) |
| `needs` (free text, bounded), `device_count_band` (enum), `interested_modules` (array) | |
| `locale` (`id`/`en`) | for reply emails |
| `status` enum `pending / approved / rejected / spam` | transitions: `pending → approved`, `pending → rejected`, `pending → spam`; anything else is **409** with a state explanation |
| `reviewed_by`, `reviewed_at`, `review_note`, `rejection_reason` | |
| `tenant_id` (nullable FK, set on approval), `admin_user_id` (nullable) | |
| `source_ip_hash`, `user_agent`, `created_at` | a hash, not the raw IP, unless the owner decides otherwise |
| `consent_at`, `privacy_notice_version` | evidence of the notice shown |

**Endpoints**

| Method + path | Gate | Behaviour |
|---|---|---|
| `POST /api/v1/access-requests` | **public**; `endpointRateLimiter("accessRequest", { byIp: true })` (e.g. 3 per hour per IP) plus a per-email cap; honeypot field (owner: no captcha); a minimum-fill-time check (a signed timestamp issued with the page) | validate (Zod, `validate(schema, { from: "body" })`); **always answer 202 with the same body**, whether or not the email already has a request or an account (no oracle); silently mark honeypot hits `spam`; notify operators via `alert.service`; send an acknowledgement email only if the per-email cap allows |
| `GET /api/v1/access-requests?status=&q=&page=` | `auth`, `superAdminOnly` | list; rows in `data`, pagination in top-level `meta` (the envelope rule) |
| `GET /api/v1/access-requests/:id` | `auth`, `superAdminOnly` | detail; `:id` route, so it needs a guard entry (platform-only allow-list, not a two-tenant test, since the model is platform-owned; the guard in `twoTenantRoutes.guard.test.ts` must be updated in the same change) |
| `POST /api/v1/access-requests/:id/approve` | `auth`, `superAdminOnly` | body: tenant `code`, `name` (prefilled), plan, `maxUsers`, admin role. **One transaction:** create tenant (reuse `tenant.service.createTenant` internals), create the tenant administrator **with no usable password** and an invitation purpose token, set request `approved` with `tenant_id`/`admin_user_id`, write audit rows under PLATFORM and under the new tenant. Email the invitation **after commit**. 409 if not `pending`; 409 if the email already belongs to a user (state explanation: "an account with this address already exists — resolve it before approving") |
| `POST /api/v1/access-requests/:id/reject` | `auth`, `superAdminOnly` | body: reason (internal) + optional message to the requester; audited; email optional (owner decision Q-5) |
| `POST /api/v1/auth/invitation/accept` (or reuse a set-password purpose) | public, `authPreCheck`-style limiter | token + new password; sets `isEmailVerified: true` (the mailbox is now proven), clears the invite; then normal sign-in, with MFA enrolment if the tenant's MFA policy requires it |

**Frontend**

- `/request-access` public page (replaces `/register` in all links; `/register` redirects there): fields above, honeypot, privacy notice link, a success state with an `<h1>`, ID/EN.
- `dashboard/tenants` → "Access requests" tab for super admins: list with status filter, detail drawer, Approve (tenant code/name prefilled from the request; code uniqueness is checked server-side and a 409 explains it), Reject with reason, Mark as spam.
- `/invitation?token=` page to set the password (autocomplete `new-password`, the password rule shown up front).

**Also required by the repo's Definition of Done** (CLAUDE.md): an ADR (this reverses the "self-registration" UI path and adds a platform-owned, non-tenant model), a migration verified with `make migrate-verify`, TypeScript for every new backend file (ratchet), an audit row inside each transaction, tests for the 409 transitions, the constant 202 answer, the honeypot, and the rate limit, and a two-tenant/allow-list entry for each `:id` route.

### 6.3 Security notes for the new endpoint

- Constant response and constant work: do the same DB write and enqueue the same job whether or not the address is known, so timing does not leak.
- Do not create a user or reserve an email at request time (avoids re-creating the squatting problem of §5.5).
- Take the email link origin from configuration, not from `Origin`/`Host` (DECISIONS l.4099).
- Cap `needs` length and strip HTML; the super-admin screen renders it as text, never through `dangerouslySetInnerHTML`.
- `endpointRateLimiter` fails open on a Redis fault; accept that or add a small in-memory fallback. Behind the Cloudflare tunnel, `req.ip` must resolve to the client (A-16) or every request shares one bucket.
- Retention: purge `rejected`/`spam` requests after a fixed period (the data-retention cron exists) and record it in the privacy notice.

---

## 7. Visual and Performance State

### 7.1 Layout, type, motion (as built)

- **Mood:** light-first "clinical precision": slate background, blue-700 primary, cyan-800 accent (ADR-090 tokens), aurora blobs and a faint blueprint grid (`AuroraBackground`), photographic sections with tilted frames. Dark mode is a token swap, not a designed dark theme. The owner's direction (near-black, one teal accent) is a new visual system, not a re-skin.
- **Type:** Space Grotesk (display, sans), Inter (body), JetBrains Mono (hashes, codes). The owner wants a **serif display**; free OFL candidates that ship Latin Extended (enough for Indonesian): Fraunces, Newsreader, Source Serif 4, Instrument Serif. Load one weight range with `next/font/local` to avoid the build-time Google fetch.
- **Motion stack:** Lenis smooth scroll + GSAP ScrollTrigger + SplitText + Motion + CSS keyframes, on one page. That is three animation systems for "subtle & premium". A single one (CSS + `motion` or GSAP alone) would cut weight and the chance of scroll-jank.
- **Brand mark:** the product mark is navy/teal (`#001250`/`#00DAB4`); on a near-black surface the navy body needs its `currentColor` white variant, which `BrandIcon` already supports.

### 7.2 Weight (production build on disk, 2026-09-29 17:47; chunks from each page's client-reference manifest plus root main files)

| Page | JS raw | JS gzip | Notable |
|---|---|---|---|
| `/` | ~951 KiB | **~305 KiB** | GSAP + ScrollTrigger + SplitText + Lenis + Motion chunk alone ≈ 61 KiB gzip |
| `/login` | ~750 KiB | ~234 KiB | Motion for a tab indicator and a cross-fade |
| `/register` | ~619 KiB | ~190 KiB | |
| `/verify/[n]` | ~601 KiB | ~185 KiB | jsPDF is loaded on demand (not in the initial set) |
| CSS (shared) | 118 KiB raw | — | one stylesheet for the whole app, including dashboard styles |
| Fonts | 16 `.woff2` files, 3 preloaded | — | JetBrains Mono is loaded on every page though only hashes and codes use it |

### 7.3 LCP concerns

1. **The hero `<h1>` renders at opacity 0 on the server.** `HeroSection` uses `initial={reduced ? false : "hidden"}` and `reduced` is `false` during SSR, so the text that is the likely LCP element stays invisible until the client bundle hydrates and the stagger runs (about 0.04 s delay + 0.08 s × index + 0.6 s). LCP therefore depends on ~305 KiB of JS. Render the hero text visible on the server and animate only a decorative layer, or use a CSS-only entrance that does not start from `opacity: 0`.
2. The entire landing is `"use client"` (`app/page.tsx`), so no section is a server component and the page cannot export its own `metadata` (it inherits "Hospital Device Callibrator").
3. Every route is rendered per request (ADR-071 nonce), so there is no static HTML cache; server render time adds directly to TTFB. Keep the public pages cheap to render (no backend fetch on the landing).
4. Hero image `step-calibrate.jpg` (44 KB) is `preload` + `unoptimized`; fine. `cta-band.jpg` (357 KB) and `hero-clinician.jpg` (202 KB, auth panel, `priority`) are the heaviest images; the auth panel image is preloaded even on phones where the panel is `display:none` (`sizes` gives `0px`, but `priority` still preloads).
5. `AnimatedBackground` + `AuroraBackground` stack several `blur-[120px]` layers, fixed and animated; this is GPU-expensive on low-end Android devices common among hospital staff.

---

## 8. Recommendations, in Order

1. **Remove every fabricated element before anything else** (§3.3 H1/H7/H8/H9, §3.4, §3.9, §3.10, P1, C9, HIPAA/SOC 2 chips) — it is live on the public site today, independent of the revamp.
2. Replace "Create a tenant workspace" and the register page with **Request access** (§6), and hide the `/register` route.
3. Add **forgot/reset password** pages (backend is ready).
4. Build the copy from §3.14 facts; use "mendukung / supports" for every framework; add the "not a certification body" line (C14).
5. Decide the product **name** (Q-1) and apply it to `<title>`, nav, footer, logo SVG `<title>`, auth default, blog metadata.
6. Show **passkey** on the login mockup as a planned method; ship it only with §5.4's backend work and ADR.
7. Fix the auth a11y items in §5.1/§5.5 (autocomplete, live regions, tab semantics, one `<h1>`, remove "Remember me").
8. Decide the **certificate enumeration** question (§5.9) before the landing gains a lookup form.
9. Server-render the hero text visibly; consolidate on one animation library; switch fonts to `next/font/local` with the chosen serif.
10. Write a single asset credits file and delete the randomuser.me avatars, unused starter SVGs and `SecuritySection.tsx`.

---

## 9. Open Questions for the Owner

| # | Question | Why it blocks |
|---|---|---|
| Q-1 | Which string is the product name on the public site: **Callibrator**, **Device Calibrator**, or **HDC**? And the legal entity for the copyright line? | four names are in use; the logo SVG says "Device Calibrator" |
| Q-2 | Should the landing name **KARS/SNARS**, or the current Kemenkes standard (**STARKES**) and "lembaga akreditasi"? | SNARS is likely superseded (§3.1, medium confidence) |
| Q-3 | Disable the public `POST /auth/register` endpoint once request access exists? | it is the only enumeration oracle left, allows address squatting, and sends mail to arbitrary addresses (§5.5) |
| Q-4 | On approval: invitation link (recommended) or a temporary password the super admin sends? | decides whether `/auth/invitation/accept` is built |
| Q-5 | Is a rejected requester told, and with what message? | email template + copy |
| Q-6 | Does a passkey sign-in count as MFA for accounts with TOTP enabled, and for platform operators? | §5.4 item 3; needs an ADR |
| Q-7 | How long are access requests (personal data) kept, and who is the data controller named in the privacy notice? | GDPR Art. 13 / UU PDP; retention purge |
| Q-8 | Certificate verification: rate limit only, or an unguessable QR token, or fewer public fields? | §5.9 |
| Q-9 | Keep blog/news in the public nav of the revamp? | they use the current `LandingLayout` and would need restyling too |
| Q-10 | WhatsApp number and sales email (placeholders until supplied, per the brief) | the primary CTA has no destination |

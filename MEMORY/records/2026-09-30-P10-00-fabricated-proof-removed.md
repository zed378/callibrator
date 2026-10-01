# 2026-09-30 — P10-00: fabricated proof removed from the live pages

**Card:** P10-00 · **ADR:** ADR-098 (Amendment 1 row 11) · **Status:** DONE

## Removed (every string and file)

- **Sections** (files deleted): `components/landing/TrustSection.tsx` (hospital marquee — one a real network's name — and ISO 17025/HIPAA/KARS/SNARS/SOC 2 chips), `TestimonialsSection.tsx` (four fictional people with randomuser.me faces, invented quotes and hospitals), `PricingSection.tsx` (Starter/Professional/Enterprise, "Most popular", "14-day free trial · No credit card required · Cancel anytime"), `PlatformSection.tsx` (a Pexels laptop graph shown as the product under an invented `app.hdc.health`), `SecuritySection.tsx` (unverified operations claims), `hero/HeroChips.tsx` ("99.2% on schedule", "Audit-ready").
- **Hero:** the pulsing "12,000+ instruments calibrated within tolerance" pill (`animate-ping`), the "ISO 17025 · Traceable standards" eyebrow, the four-avatar trust cluster ("Trusted by biomedical & calibration engineers … ISO 17025 & KARS"), the three `heroStats` count-up cards ("12,000+", "40%", "99.2%"); "Start free trial" → "Sign in".
- **Other sections:** the "Audit prep: Days → minutes" card; the four accreditation cards; the patient-monitor photo cell; the CTA band's trial ticks and "Book a walkthrough"; "Start free trial" in the CTA band and in `app/blog/[slug]/page.tsx`.
- **Data:** `data/landing.ts` exports `heroStats`, `accreditations`, `testimonials`, `partners`, `pricingTiers`, `platformCapabilities` (the whole file deleted in P10-03).
- **Auth:** `AuthBrandingPanel` "ISO 17025-aligned workflows", "HIPAA-ready access controls", the "compliant, and audit-ready" tagline; the register tagline "— compliant from day one"; the login link "Create a tenant workspace"; the dead "Remember me" checkbox (05 A9); the SSO placeholder "e.g. hca-group" (05 A12).
- **Navigation/footer:** nav "Get Started" → "Sign in"; the Platform and Pricing anchors; every `href="#"` footer link (Documentation, API Reference, Community, Contact, About Us, Careers, Partners, Privacy Policy, Terms of Service).
- **Files:** `public/marketing/avatar-1.jpg` … `avatar-4.jpg`, `platform-dashboard.jpg`, `feature-monitoring.jpg`, `public/{file,globe,next,vercel,window}.svg`. `public/marketing/CREDITS.md` rewritten to state what was removed.

Nothing was hidden by CSS or a flag: each item is gone from source and bundle.

## Evidence

- `npx jest src/app/login src/app/register src/app/blog src/components/layouts` at the time — 186 passed. The one login test asserting "Create a tenant workspace" was rewritten to assert it and "Remember me" are gone (later superseded by `app/login/__tests__/loginFlow.p1004.test.tsx`). `menuHelpers.seedIcons.a118.test.ts` failed then — another agent's seed change.
- From P10-11 on, `src/tests/public/copyTruthfulness.p1011.test.ts` fails the build if any of these terms returns.

# Research 04 — Competitor Landings, Premium Benchmarks, and Auth Pages

**Date:** 2026-09-29 · **Type:** desk research (secondary sources) plus a read of the current landing, login and register code. No users were studied. · **Status:** input to the landing, login and register revamp. It is not a decision. A change that moves `docs/` (for example, dropping "SNARS" from the compliance list) goes through an ADR.

**Owner direction this research serves:** a public landing page, login and register that feel premium and grand ("mewah dan megah", clearly not cheap) while staying credible, with over-claimed copy removed.

**Read with:** [`02-standards-and-benchmarks.md`](02-standards-and-benchmarks.md) (enterprise patterns, WCAG, locale), [`../17-ACCESSIBILITY.md`](../17-ACCESSIBILITY.md), ADR-071 and ADR-090 in [`../../../MEMORY/DECISIONS.md`](../../../MEMORY/DECISIONS.md) (nonce CSP, no third-party image origins, theme tokens).

---

## 0. Method, and How Far to Trust Each Claim

| Source class | How it was read | Confidence |
|---|---|---|
| Competitor landing pages (Nuvolo, Accruent TMS, Blue Mountain, GAGEtrak, eMaint, MasterControl/Qualer, Beamex CMX, IndySoft, TMA/ProCal, EQ2 HEMS, PT GETS) | fetched with an automated reader that converts the page to text and answers questions about it. **Layout, colour and motion are inferred from that summary, not seen.** | **medium** for copy and section order, **low** for visual style |
| Premium benchmarks (Linear, Stripe, Ramp, Veeva, Philips) | same reader. Ramp served a "machine version" of its page to the reader, so its visual layer was not captured | medium for copy, low for visuals |
| Standards and regulators (W3C WCAG, NIST SP 800-63B, OWASP, FIDO Alliance/Passkey Central, FTC, UU 8/1999) | page fetched and read | **high**, quoted |
| Legal commentary (HIPAA "certification", Part 11 vendor claims, SOC 2 logo use, Etika Pariwara Indonesia) | search-engine extracts of law-firm, auditor and academic pages | medium. **Not legal advice: have counsel check any claim before it ships** |
| Asset licences (Unsplash, Pexels, Lucide, OFL fonts, unDraw, Storyset) | licence pages fetched where possible, the rest from search extracts | high for Unsplash, Pexels and Lucide; medium for the rest |
| Callibrator code | files read directly (paths given in §4 and §5) | high, as of 2026-09-29 |

Two sites could not be read: **samrs.cloud** (connection reset twice) and **calibrationcontrol.com** (fetch failed). What is said about them comes from search extracts only.

**What this research cannot tell you:** whether Indonesian hospital buyers (the biomedical engineering head (Kepala IPSRS), the quality committee, procurement, the director) read "premium" the way a Western SaaS audience does. §8 lists the questions to settle before the design is fixed.

---

## 1. Direct Competitors: What Their Landings Do

### 1.1 Summary table

| Vendor | Hero message (verbatim) | Primary CTA | Proof shown | Numbers sourced? | Pricing on page | Compliance wording |
|---|---|---|---|---|---|---|
| **Nuvolo** (HTM, built on ServiceNow) | "Maximize Asset Lifecycles" / "Manage your HTM department with one modern CMMS." | REQUEST A DEMO | Large product screenshot, integration partners (PartsSource, GE, Siemens). **No logos, no numbers** | n/a | no | Generic "regulatory compliance", no standard named |
| **Accruent TMS** | "Accruent TMS: CMMS for Healthcare Facilities & Technology Management" + 3 benefit lines | Request a Demo | Stat band ("$200K+ compliance incidents savings/year", "$50K+ savings/year per technician", "healthcare centric since 1995"), customer quotes ("99% paperless", "200% ROI") | **No.** Savings figures have no method or footnote | no (pricing link in footer) | "Joint Commission standards" |
| **Blue Mountain RAM** (life sciences) | "Asset Management Built for Life Sciences" / "...the only cloud-native EAM platform pre-validated for GMP environments." | SCHEDULE A DEMO | 450+ customers, 39 countries, 60K users, 2.7M assets, 230K+ work orders/month, 35 years; 9 named logos (Thermo Fisher, Lonza, BD...); 3 role-attributed quotes | Counts are unsourced but checkable in kind; "the only" is a superlative | no | "Pre-validated and GxP ready"; e-signatures and audit trails "**aligned with** 21 CFR Part 11 and GAMP 5"; "SOC 2 compliant" |
| **GAGEtrak** | "Revolutionize and modernize the way you manage your measurement and test equipment." / "Recommended by auditors and trusted by quality professionals for over 35 years." | START YOUR FREE TRIAL | 4 named testimonials with company (AngioDynamics...) | "35 years" only | no | "compliance with international quality standards such as FDA and ISO" (vague) |
| **eMaint** (Fluke Reliability) | "Because being prepared for anything is your area of expertise." | Book a demo | 150K users, 116 countries, 7,400 teams, 40 years; G2/Capterra/Software Advice badges; named customer outcomes ("Crown Cork: $1M saved") | Badges are third-party and dated (G2 Winter 2026); "20–30% average downtime reduction" is unsourced | on a separate plans page | none on home |
| **MasterControl Asset Excellence** (ex-Qualer; qualer.com now 301-redirects here) | "Introducing MasterControl Asset Excellence" | Contact Us to Learn More | Customer logos only | no numbers | pricing page linked | ISO, FDA, GMP, ISO 17025 named as context, **not as badges** |
| **Beamex CMX** | "Beamex CMX" + "calibration management software" | Download brochure / Schedule free demo / Schedule consultation | Case studies with outcomes (1-year ROI, 50% efficiency, 4,000 h/yr) tied to named customers (AstraZeneca, National Grid) | Tied to a named case study | no, quote form | "meets the requirements of 21 CFR Part 11" (a strong claim) |
| **IndySoft** | "Calibrate. Manage. Comply." | Let's Talk | **None on home**: no logos, no numbers | n/a | no | ISO/IEC 17025 for labs; 21 CFR Part 11, GMP, GLP, GCP for life sciences, **per industry page** |
| **TMA Systems** (now owns ProCal and EQ2 HEMS; primetechpa.com 301-redirects here) | "Calibration Management Software" / "Paperless calibration management" | Request a demo / Find your product fit | ~10 logos, 3 named quotes, "30+ years" | no | separate pricing page | "Be audit-ready at all times with pre-validated and ISO/FDA compliance" (over-claims: "ISO/FDA compliance" is not a thing a product has) |
| **EQ2 HEMS** (acquired by TMA, March 2025) | "CMMS Software for Biomedical, Imaging, Facilities and Support Services" | Request a Demo | 30+ years, AAMI and ASHE memberships, news and events | no | no | none |
| **PT GETS** (Indonesia) | "Aplikasi Alat Kesehatan — sistem digital yang dirancang untuk mempermudah pengelolaan, pemeliharaan, dan pelaporan alat kesehatan..." | **WhatsApp** ("Hallo PT GETS, Saya Ingin Bertanya") | Generic ("government hospitals, clinics, labs"), no named clients; hero image looks AI-generated | n/a | no | Kemenkes, BPOM mentioned; no ASPAK or KARS |
| **SAMRS Cloud** (Indonesia, not fetched) | (search extract) cloud maintenance and asset management for medical and non-medical equipment | unknown | "lebih dari 30 rumah sakit" | unknown | unknown | unknown |

Adjacent Indonesian players are hospital-information-system (SIMRS) vendors with an asset module (HashMicro, SIMRS.ID, iMedis, SIMRS Indonesia "Dipercaya 70+ RS dan Klinik"). They lead with **"Demo Gratis"** and WhatsApp, and the government systems buyers already use are **ASPAK** (Kemenkes inventory and reporting of facilities, infrastructure and medical devices) and the state asset systems (SIMAK-BMN, SIMAN).

### 1.2 Patterns across the category

1. **The category sells through demos.** 9 of the 11 vendors read lead with "Request/Schedule/Book a demo" or "Let's talk". Only GAGEtrak (desktop-heritage, ~$768 per seat) and ProCal offer a self-serve trial. **No healthcare HTM vendor shows prices on its landing page.** Callibrator's hero today says "Start free trial" and links to `/login` (§4). That is the wrong promise for this market, and it does not do what it says.
2. **The most credible pages name one standard per audience and use the verb "aligned with" or "supports".** Blue Mountain ("aligned with 21 CFR Part 11 and GAMP 5") and IndySoft (per-industry pages) are the careful ones. TMA's "ISO/FDA compliance" and GAGEtrak's "compliance with ... FDA and ISO" are the vague, over-claiming end. Nobody credible shows a standard as a **badge** unless it is a certification the vendor holds (SOC 2).
3. **Proof ranks roughly as:** named customer logo with a named, role-attributed quote → third-party dated badge (G2 Winter 2026) → case-study outcome tied to a named customer → aggregate counts ("450+ customers") → unsourced percentages ("20–30% less downtime"). The last kind is common and adds little.
4. **Heritage replaces proof when there is little.** "30+ years", "35 years", "since 1995". Callibrator cannot use it and should not imitate it. Its honest equivalents are **transparency** (a public security and compliance page, a dated changelog) and **specificity** (showing the real certificate, the real audit trail, the real calibration entry).
5. **Visual style in the category is conservative:** blue and white, icon rows, stock photos of technicians, and a product screenshot. **Nobody in HTM or calibration looks premium.** That is the opening: a restrained, precise, product-led page would stand out in this set without having to shout.
6. **Indonesian norms differ:** WhatsApp as the primary contact, "Demo Gratis", Bahasa Indonesia first, references to Kemenkes rather than FDA. A page that speaks only of FDA and HIPAA reads as imported and not written for them.

---

## 2. Premium Benchmarks: What Makes a B2B Page Feel Expensive

### 2.1 Observations

| Site | What carries the premium feeling | Transferable? |
|---|---|---|
| **Linear** | One sharp headline ("The product development system for teams and agents"); **real product UI** as the hero, not an illustration; dark theme; large bold sans; generous spacing; subtle motion; logos only near the end (OpenAI, Ramp) | Yes: real UI as hero, type-led hierarchy, restraint. Dark-only is **not** (see 2.3) |
| **Stripe** | A plain declarative headline; one signature animated gradient as the brand motif; customer logos directly under the hero, **without commentary**; big, dated-by-context numbers ("$1.9T in payments volume processed in 2025", "99.999% historical uptime") | Yes: one signature motif, logos without adjectives. The numbers only work because they are real and checkable |
| **Ramp** | Numbers everywhere, but **customer-specific outcomes are attributed** (8VC: "325 hours saved per month"; Poshmark: "50% faster month-end close"); a public Trust Center link in the header | Yes: attribution on every outcome, a Trust Center link in navigation |
| **Veeva** (regulated life-science cloud) | Category-defining headline ("The Industry Cloud for Life Sciences"); 13 top-pharma logos; monochrome photography; a "Trust" footer link; PBC badge | Yes: the tone regulated buyers expect: calm, factual, institutional |
| **Philips Healthcare** | Mission headline ("Better care for more people"); real clinical photography of clinicians, patients and equipment; one results disclaimer: "Results are specific to the institution where they were obtained and may not reflect the results achievable at other institutions." | Yes: that disclaimer is the model for any outcome figure Callibrator later publishes |

### 2.2 The recipe, stated as rules

"Premium" in the benchmarks comes from **restraint and precision**, not from effects:

1. **Type does the work.** One display face at large size with tight, deliberate tracking; a quiet text face; tabular figures for every number (Vercel's guidelines: "Use `font-variant-numeric: tabular-nums`" for numeric comparison).
2. **The product is the hero image.** Every benchmark with a product shows the real UI, cropped and staged at high resolution. NN/g eye-tracking found that "big feel-good images that are purely decorative" are ignored, while product images and photos of **real** people are scrutinised and build credibility ([NN/g, Photos as Web Content](https://www.nngroup.com/articles/photos-as-web-content/)).
3. **One signature motif, used everywhere and never loud.** Stripe's gradient, Linear's hairline glow. For a calibration product the natural motif is **metrology itself**: graduation ticks, a vernier scale, a tolerance band, the needle of a gauge settling. It belongs to Callibrator and no competitor uses it.
4. **Few colours, one accent.** Neutral ink and paper, one brand accent, semantic colours (success/warning) only where they carry meaning.
5. **Motion explains; it does not decorate.** Vercel: animate "when it clarifies cause & effect or when it adds deliberate delight", and always provide a reduced-motion variant.
6. **Whitespace and a slow scroll rhythm.** Fewer sections, each with one idea.
7. **Proof is quiet and exact.** Logos without adjectives, quotes with a name, role and organisation, numbers with a date and a source.
8. **Detail signals care.** NN/g's first credibility factor is design quality: "Typos, broken links, and other mistakes quickly degrade credibility" ([NN/g, Trustworthiness in Web Design](https://www.nngroup.com/articles/trustworthy-design/)). Curly quotes, correct Indonesian spelling (EYD), consistent capitalisation, and no dead links matter more than a 3D canvas.

### 2.3 What to avoid (the "cheap" signals)

- **The generic "Linear look".** LogRocket's analysis of the trend warns that "all the products that follow the trend start to look monotonous", and that glassmorphism "is very difficult to do differently" ([LogRocket](https://blog.logrocket.com/ux-design/linear-design/)). Borrow the discipline, not the purple glow.
- **Dark-only.** The same article notes that many such sites lack a light mode, which undermines accessibility. Hospital buyers read on bright office monitors and projectors. Recommendation: a **dark, "grand" hero band** on a page that is otherwise light (or follows the system theme), which the current theme tokens support.
- **Gradient text, magnetic buttons, floating chips, count-up numbers, a pulsing "live" dot.** The current hero uses all of them (§4). Together they read as a template, and the live dot implies real-time data that does not exist.
- **Stock photos of models and AI-looking clinical scenes.** PT GETS's hero is an example of what the Indonesian market already sees.
- **Auto-scrolling logo marquees** without a pause control (WCAG 2.2.2, §3.5).

### 2.4 "Mewah dan megah", translated for this product

| Owner word | Design means | Not |
|---|---|---|
| **Mewah** (luxurious) | Fine materials: precise type, hairline rules, deep ink backgrounds with a subtle grain, a real product surface rendered crisply, slow and exact motion | Gold, glitter, heavy shadows, "premium" badges |
| **Megah** (grand, imposing) | Scale: a large display headline, a full-bleed hero, wide margins, a long unhurried scroll with a few big set pieces (the certificate, the audit trail, the multi-site view) | Crowding more sections in, auto-playing video, a carousel of claims |
| **Credible** | Specific, dated, attributable, and smaller than it could be | Superlatives, badges not held, fictional people |

---

## 3. Login and Register Patterns for Enterprise Multi-Tenant B2B

### 3.1 Layout: split-screen or centred

Both are used by serious products. **Split-screen** (brand panel plus form) suits a premium direction and a page that is also a brand moment. **Centred** suits a tenant-branded login where the hospital's logo leads. Callibrator already has a split layout (`AuthBrandingPanel` plus form) and a tenant branding hook (`useAuthBrand`). Keep the split on the platform domain, and collapse to a centred, tenant-branded card when the login is reached through a tenant's own domain or link. The brand panel is `hidden ... lg:block`, so on mobile it disappears. Make sure the page still has exactly one `<h1>` at every width (today the desktop `<h1>` is in the brand panel and the mobile one in the form, which works, but the form title "Welcome back" is an `<h2>` under an `<h1>` that is the product name: acceptable, but see 3.7).

### 3.2 Finding the tenant: universal login or organisation-specific

| Pattern | How it works | Examples | Fit for Callibrator |
|---|---|---|---|
| **Universal, identifier-first** | One login page. The user types an email. The domain or account decides the tenant and whether to show a password field or redirect to SSO (home realm discovery) | Notion, Google, Dropbox (hides the password field for SSO domains) | **Best long-term.** Staff do not know a "tenant code" |
| **Organisation-specific** | Each tenant has its own URL (`rs-harapan.callibrator...`) or a code the user types | Slack workspaces | Works when hospitals give staff a link; fails when a user forgets it |
| **Hybrid** | Universal page, with tenant-branded deep links for hospitals that want them | most mature B2B | **Recommended** |

Sources: [Scalekit](https://www.scalekit.com/blog/designing-b2b-authentication-experiences-universal-vs-organization-specific-login) (Notion vs Slack vs Dropbox), [Auth0 identifier-first](https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first), [Kinde HRD](https://docs.kinde.com/authenticate/enterprise-connections/home-realm-discovery/).

**Current state:** the login has two tabs, "Password Login" and "Enterprise SSO". The SSO tab asks the user for a **tenant code** (placeholder "e.g. hca-group") **and a protocol, SAML or OIDC** (`app/login/components/SsoLoginForm.tsx`). A nurse or a technician does not know which protocol their hospital's identity provider uses, and should never be asked. The protocol belongs to the tenant's SSO configuration, which the backend already resolves by `tenantCode` (`/auth/sso/login`, `/auth/sso/oidc/login` in `backend/src/routes/api/auth.route.js`).

### 3.3 Passkeys, TOTP and SSO on the sign-in page

- **Passkeys.** FIDO's guidance puts **autofill first**: "Enable autofill by adding `autocomplete="webauthn"` to the `username` input field", which "ensured the highest success"; a separate "Sign in with a passkey" button is secondary, for crowded pages or parity with social buttons; always "support graceful fallback" ([Passkey Central, Sign in with a passkey](https://www.passkeycentral.org/design-guidelines/required-patterns/sign-in-with-a-passkey)). The term is lower-case "passkey".
  - **Caveat from the code:** Callibrator's WebAuthn login endpoints (`/webauthn/login-options`, `/webauthn/verify-login`) are documented with `security: bearerAuth` (`backend/src/routes/api/webauthn.route.js`), which suggests passkeys are a **step-up for a signed-in user**, not a primary sign-in. **Do not put a passkey button on the login page until a pre-authentication ceremony exists.** This needs confirming (Q7).
- **TOTP.** The MFA step already sets `inputMode="numeric"` and `autoComplete="one-time-code"` (`MfaLoginForm.tsx`). Keep it a **single field** that accepts paste: WCAG 2.2 SC 3.3.8 fails OTP entry that cannot be pasted, and split digit boxes that block paste fail it too ([W3C, Accessible Authentication](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)). The recovery-code toggle exists; keep it visible, not hidden.
- **SSO button.** Label it by what the user recognises ("Continue with your hospital account", "Masuk dengan akun rumah sakit"), never by protocol.

### 3.4 Register: self-serve or request access

For hospitals, self-serve sign-up is the exception. Self-service works "when you can offer an inexpensive version and the product can be deployed in under an hour"; healthcare leans to sales-led onboarding with self-service administration **after** purchase (search extract of [SaaStr](https://www.saastr.com/prevalent-among-b2b-saas-startups-offer-self-service-signup-plans-e-g-no-sales-touch-sign-via-credit-card-percentage-b2b-saas-startups) and the SSOJet and Auth0 B2B material). The competitor set agrees (§1.2).

**Current state, which the redesign must not paper over:**

- The login page's link says **"Create a tenant workspace"**, and the register page says "Create your workspace". But `authService.registerUser` (`backend/src/services/auth.service.js`, line 202) creates a **user** with first name, last name, username, email and password, role `USER`, and **no tenant**. There is no organisation field in `RegisterInputs.tsx`. **The page promises a workspace and delivers a tenant-less account.** That is itself an over-claim.
- The same function returns **409 "Email already registered"** and **409 "Username already used"**. That is an account-enumeration oracle, contrary to OWASP: registration should respond "A link to activate your account has been emailed to the address provided" whatever the case ([OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)). The redesign should use the neutral message; the backend change is a separate, security-reviewed task.
- The activation link is built from the request's `Origin`/`Host` header (`baseOrigin = origin || ""`). Out of scope for UX, but worth a security review, since a forged header can put an attacker's domain in the activation email.

**Recommended model:** replace public self-registration with **"Request access / Minta demo"** (organisation name, facility type, city, number of devices, contact name, work email, WhatsApp number, consent). Keep **invitation-based** account creation for staff (an admin invites; the invitee sets a password or links SSO). If the owner wants a self-serve trial, it should create a **sandbox tenant** with sample data, and say so.

### 3.5 Passwords, errors and accessibility

| Rule | Source | Current state |
|---|---|---|
| Minimum 15 characters for password-only accounts, 8 when used with MFA; allow at least 64; **no composition rules**; check against a blocklist of breached and common passwords; **no forced periodic rotation**; allow password managers and paste; offer "show password"; no hints | [NIST SP 800-63B-4 §3.1.1.2](https://pages.nist.gov/800-63-4/sp800-63b.html) | Show/hide toggle exists (register). Rules not checked in this pass: compare `registerSchema` against NIST before writing helper text |
| Every user-information field has an `autocomplete` token (`username`, `email`, `given-name`, `family-name`, `current-password`, `new-password`) | [WCAG 2.1 SC 1.3.5, Level AA](https://www.w3.org/WAI/WCAG21/Understanding/identify-input-purpose.html) | **Failing.** `PasswordLoginForm.tsx` and `RegisterInputs.tsx` set no `autoComplete` (a grep for it finds only the MFA form). This is an AA failure in the project's own target |
| No cognitive-function test without an alternative; allow paste and password managers; no transcription CAPTCHA | [WCAG 2.2 SC 3.3.8, AA](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) | The project targets 2.1 AA; 3.3.8 is 2.2 but cheap to meet. Keep paste enabled everywhere |
| One generic failure message: "Login failed; Invalid user ID or password", including for locked or disabled accounts; neutral reset and registration responses | [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) | Login error text not audited here. Register leaks (3.4) |
| Errors next to the field; focus the first error on submit; keep submit enabled until the request starts, then show progress | [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) | The login shows one banner above the form with a lock icon. Add field-level association (`aria-describedby`) and move focus to it |
| Moving content that starts automatically and lasts over 5 s needs a pause, stop or hide mechanism. **Pause-on-hover or pause-on-focus is not enough** | [WCAG 2.1 SC 2.2.2, Level A](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html) | **Failing on the landing:** the logo marquee (`components/motion/Marquee.tsx`) pauses only on hover (static under reduced motion, which helps but is not the mechanism the SC asks for). Add a visible pause button or make it static |
| A "Forgot password" path on the sign-in form | common practice | **Missing.** The backend has a forgot-password OTP route and `/auth/reset-password` (`auth.route.js` lines 192–270) but no frontend page links to them |

### 3.6 Language (ID and EN)

The login and register pages are English only (no i18n hook in `app/login` or `app/register`). The Indonesian buyer and most daily users read Indonesian first. Provide both, with Indonesian as the default for `id` locales, and a visible language switch on the auth pages. Keep the terms users know: "Masuk", "Daftar", "Lupa kata sandi?", "Kode verifikasi", "Masuk dengan SSO rumah sakit".

### 3.7 Small copy fixes

- "Return to Home" becomes "Kembali ke beranda / Back to home", placed top-left, not above the title.
- "Welcome back / Sign in to your account to continue" is filler. Replace with the tenant's name when known ("Masuk ke RS Harapan Kita") or the product's promise when not.
- "Password Login" / "Enterprise SSO" tabs become one identifier-first form (3.2).

---

## 4. Copy Credibility: Rules, and the Current Page Audited

### 4.1 The rules

| Claim type | Why it is an over-claim | Source | Say instead |
|---|---|---|---|
| "HIPAA compliant / HIPAA-ready / HIPAA badge" | HHS "does not offer, endorse, or recognize any HIPAA certification"; the FTC has treated such representations as potentially deceptive because they imply a government determination. HIPAA is also a US law that does not govern Indonesian hospitals | [Fisher Phillips](https://www.fisherphillips.com/en/insights/insights/how-healthcare-organizations-must-vet-ai-vendors-that-overstate-their-compliance), [HIPAA Vault](https://www.hipaavault.com/resources/what-does-hipaa-certified-mean/) | For Indonesia: describe controls and name **UU PDP (UU 27/2022)** only as a law the controls help the hospital meet. Drop HIPAA from the Indonesian page entirely |
| "21 CFR Part 11 compliant" | FDA certifies no software as Part 11 compliant; compliance belongs to the regulated user's validated system and procedures. The vendor ships "compliant-capable" features | [TrialTrack](https://trialtrack.net/blog/21-cfr-part-11-compliant-software/), [ACD/Labs](https://www.acdlabs.com/blog/mythbusting-software-validation-gxp-and-21-cfr-part-11-compliance/) | "Electronic signatures and audit trails designed to support 21 CFR Part 11 requirements" (the Blue Mountain wording, "aligned with", is the market's careful form) |
| "ISO 17025" as a badge or "ISO 17025 certified/accredited" | ISO/IEC 17025 **accredits laboratories**, per scope, through an accreditation body (KAN in Indonesia). Software cannot hold it. The ILAC MRA mark is licensed only to accredited bodies for their scope | [ILAC R7](https://european-accreditation.org/wp-content/uploads/2018/10/ILAC_R7_05_2015-Rules-for-the-Use-of-the-ILAC-MRA-Mark1.pdf), [PJLA](https://www.pjlabs.com/downloads/SOP-3.pdf) | "Built around the records an ISO/IEC 17025 assessment asks for: traceability, uncertainty, and signed results." Never show a KAN, ILAC or ISO logo |
| "KARS" / "SNARS" as a badge | KARS is one accreditation body; it does not certify software. SNARS 1.1 has been superseded as the national standard by **KMK HK.01.07/MENKES/1128/2022** (Standar Akreditasi Rumah Sakit), applied by several independent accreditation bodies | [KMK 1128/2022 (Kemenkes)](https://keslan.kemkes.go.id/unduhan/fileunduhan_1654499045_682777.pdf), [KARS regulations list](https://kars.or.id/daftar-regulasi/) | "Membantu menyiapkan bukti pemeliharaan dan kalibrasi alat untuk survei akreditasi rumah sakit (Standar Akreditasi RS, KMK 1128/2022)." Confirm the chapter reference with a surveyor (Q4) |
| "SOC 2" chip | A SOC 2 claim needs a completed attestation; the AICPA logo needs AICPA permission and expires 12 months after the report date | [ComplyJet](https://www.complyjet.com/blog/soc-2-badge-aicpa-logo-tips) | Remove until an audit report exists. Then "SOC 2 Type II report available under NDA" |
| Fictional testimonials, avatars, customer names | The FTC's 2024 rule (16 CFR Part 465) bans testimonials "from someone who does not exist" and misrepresenting a testimonialist's experience; penalties up to US$51,744 per violation. Its B2B reach is not stated, but the ethics are not in doubt. In Indonesia, UU 8/1999 Pasal 9(1) bars offering a product "seolah-olah telah mendapatkan dan/atau memiliki sponsor, persetujuan..." | [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials), [FTC Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers), [UU 8/1999](https://regulasiku.id/content/UU_1999_08_Perlindungan-Konsumen.html) | Remove. Replace with a pilot hospital's real quote, with written permission, or with nothing |
| Unsourced numbers ("12,000+", "40% less audit time", "99.2% on schedule") | UU 8/1999 Pasal 17(1) bars ads that "memuat informasi yang keliru, salah, atau tidak tepat"; the FTC standard is substantiation held **before** the claim is made | [UU 8/1999](https://regulasiku.id/content/UU_1999_08_Perlindungan-Konsumen.html), [FTC Health Products Compliance Guidance](https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance) | Only numbers Callibrator can prove, dated, with a source note and the Philips-style disclaimer for outcomes |
| Superlatives ("the best", "#1", "terbaik", "paling", "nomor satu") | Etika Pariwara Indonesia: superlatives only with specific substantiation from an authority or an authentic source | [EPI analysis (ResearchGate)](https://www.researchgate.net/publication/394263904_Analisis_Pelanggaran_Etika_Pariwara_Indonesia_EPI_dalam_Iklan_Produk_Komersial_Televisi) | Describe the specific thing ("certificates signed with a verifiable QR code") |
| "Safe", "zero risk", "100% secure", "no cross-contamination risk" | UU 8/1999 Pasal 9(1) names "kata-kata yang berlebihan, seperti aman, tidak berbahaya, tidak mengandung risiko ... tanpa keterangan yang lengkap" | [UU 8/1999](https://regulasiku.id/content/UU_1999_08_Perlindungan-Konsumen.html) | Describe the control and its limit: "Each hospital's data is isolated by tenant in every query; a cross-tenant request returns not found." |
| "AI-powered" without a named capability | Unfalsifiable; buyers in regulated settings discount it | general | Name the feature and where a human stays in the loop, or omit |
| Operational promises the operator cannot yet keep ("cross-region replication", "quarterly DR drills", "TLS 1.3", "immutable audit logs") | A statement of fact about operations; false if the deployment does not do it | project's own "renders vs works" rule (CLAUDE.md) | State only what the reference deployment does, or put it on a dated security page with "planned" labels |

**Regulatory note (Indonesia):** Permenkes 54/2015 on testing and calibration of medical devices (at least once a year, by competent institutions using calibrated standards) is listed as **no longer in force** on peraturan.go.id, and the replacement was not found in this search ([peraturan.go.id](https://peraturan.go.id/id/permenkes-no-54-tahun-2015)). Do not cite a regulation number on the page until counsel confirms the current one (Q5). Callibrator is a records and workflow tool; it does not itself perform calibration, and copy must not imply that it replaces an accredited calibration provider (BPAFK or a KAN-accredited lab).

### 4.2 Current copy, audited

Files: `frontend/src/components/landing/*`, `frontend/src/data/landing.ts`, `frontend/src/components/auth/AuthBrandingPanel.tsx`, `frontend/src/app/register/page.tsx`. `data/landing.ts` itself says the testimonials and headline metrics are "illustrative PLACEHOLDERS", and `public/marketing/CREDITS.md` says the avatars and names are "fictional samples". **They are live on the public page today.**

| # | Where | Current text | Verdict | Action |
|---|---|---|---|---|
| C1 | Hero pill | "12,000+ instruments calibrated within tolerance" with a pulsing green "live" dot | **Fabricated, and implies live data** | Remove |
| C2 | Hero stats (`heroStats`) | "12,000+ instruments under management", "40% less time preparing for audits", "99.2% calibrations completed on schedule" | Fabricated | Remove. Replace with capability facts (3.1 below) |
| C3 | Hero chip (`HeroChips.tsx`) | "99.2% on schedule", "Audit-ready" | Fabricated number; "Audit-ready" is a promise | Remove the number. If the hero shows a product UI, label it as sample data |
| C4 | Hero trust cluster | four randomuser.me faces + "Trusted by biomedical & calibration engineers preparing for ISO 17025 & KARS with confidence" | **Fictional people implying endorsement** | Remove |
| C5 | Hero eyebrow | "ISO 17025 · Traceable standards · Multi-tenant" | "ISO 17025" reads as a credential | "Traceability · Signed certificates · Multi-site" |
| C6 | Hero CTA | "Start free trial" → links to `/login` | Promise the product does not keep | "Jadwalkan demo / Book a demo" (primary), "Masuk / Sign in" (secondary, in the header) |
| C7 | Trust band (`TrustSection.tsx`) | "Trusted by biomedical & quality teams across healthcare" + marquee of fictional hospitals (Meridian Health, St. Aubyn, Northgate, Valley Regional, PrimeCare, Unity Health) | **Fictional customers** | Remove the band until there are real, permitted logos |
| C8 | Trust band chips | "ISO 17025", "HIPAA", "KARS", "SNARS", "SOC 2" | Badge-shaped claims of certifications not held; HIPAA is US law; SOC 2 not audited; SNARS superseded | Remove. Replace with a "Standards we design for" section written as text (§4.1) |
| C9 | `accreditations` | "HIPAA — Data privacy & security"; "SNARS — Device-safety records mapped to SNARS requirements" | As C8. "Mapped to" asserts a mapping that should exist as a document | Keep ISO/IEC 17025 and the Indonesian hospital standard only if a requirement-to-feature mapping document exists to back them (Q4) |
| C10 | `complianceChecklist` | "Complete, immutable audit history"; "One-click export for auditors and surveys"; "Unbroken measurement traceability chain" | "Immutable" is a technical claim (is the audit table append-only at the database grant level?). "One-click" and "unbroken" are promises | Verify each against code; soften to what is true ("Audit history of every change, with user and time"; "Export for auditors") |
| C11 | Testimonials (`testimonials`) | four quotes from "Dr. Sarah Chen, Meridian Health System" and others, five stars each | **Fictional**, with star ratings implying reviews | Remove the section |
| C12 | Pricing (`pricingTiers`) | "Starter / Professional / Enterprise", features only, "Start free trial"; Enterprise lists "Multi-region & data residency", "On-premise option", "Dedicated success manager" | No prices, so it is feature gating without the one thing NN/g says buyers want most; enterprise items may be unoffered | Either publish real indicative prices (NN/g: missing pricing is "the most user-hostile element of most B2B websites", [NN/g](https://www.nngroup.com/articles/show-price/)) or replace with "How we work with hospitals" (pilot → rollout) and a demo CTA. Remove any item the owner cannot deliver (Q2) |
| C13 | `AuthBrandingPanel` | "ISO 17025-aligned workflows", "HIPAA-ready access controls", "Keep every medical device calibrated, compliant, and audit-ready" | "HIPAA-ready" as C8; "compliant" as a guaranteed outcome | "Records built for ISO/IEC 17025 assessments", "Role-based access, MFA and SSO", "Know which device is due, before it is overdue" |
| C14 | Register tagline | "Create your workspace and start managing medical device calibration — compliant from day one." | Registration does not create a workspace (§3.4); "compliant from day one" is impossible | Rewrite after the register model is decided (Q1) |
| C15 | Features | "...compliant and a team out of firefighting mode" | "compliant" as an outcome | "...ready for the survey, and a team out of firefighting mode" |
| C16 | `SecuritySection.tsx` (**not rendered**: `page.tsx` does not import it) | "End-to-End Encryption ... AES-256 ... TLS 1.3", "Immutable audit logs meeting regulatory retention requirements", "Daily encrypted backups with 30-day retention and cross-region replication ... quarterly disaster recovery drills", "no cross-contamination risk", "Slack/PagerDuty integrations" | "End-to-end encryption" is technically wrong for a server-readable SaaS; the operations claims are unverified for the reference deployment | Do not reinstate as written. If a security section returns, each line is checked against the deployment first |
| C17 | Hero headline and subhead | "Every instrument measured. Every result traceable." / "...issue tamper-evident certificates — so every measurement holds up the day an auditor asks." | **Good**: specific and product-shaped. "Tamper-evident" is supportable if certificates carry a verifiable hash or QR (the certificate PDF module has QR verification) | Keep the idea; tighten and translate |

---

## 5. Free-for-Commercial-Use Assets for a Premium Look

All assets must be **self-hosted**: the frontend's nonce CSP allows no third-party image origin (ADR-071), and fonts are already bundled with `next/font` (no CDN) in `app/layout.tsx`, which loads **Inter**, **Space Grotesk** (display) and **JetBrains Mono** today.

### 5.1 Fonts (all SIL Open Font License 1.1: commercial use, modification and bundling allowed; the font may not be sold on its own)

| Pairing | Display | Text | Numbers/code | Character | Notes |
|---|---|---|---|---|---|
| **A. "Jakarta precision"** (recommended) | **Plus Jakarta Sans** (600–800) | Inter | JetBrains Mono or Inter tabular figures | Geometric, confident, local | Designed by Gumpita Rahayu (Tokotype), commissioned for Jakarta's "+Jakarta City of Collaboration" identity (2020), OFL ([Tokotype GitHub](https://github.com/tokotype/PlusJakartaSans), [mini-site](https://tokotype.github.io/plusjakarta-sans/)). An Indonesian-made typeface is a quiet, true story for an Indonesian product |
| **B. "Editorial grand"** | **Instrument Serif** (display only, large sizes) | Inter or Geist | Geist Mono | Luxurious, magazine-like | OFL ([GitHub](https://github.com/Instrument/instrument-serif)). Only Regular and Italic: use it for one headline per section, never for UI |
| **C. "Engineering institutional"** | IBM Plex Sans (600) | IBM Plex Sans | IBM Plex Mono | Sober, technical, trustworthy | OFL ([IBM/plex](https://github.com/IBM/plex)). Least "wow", most "hospital procurement" |
| Current | Space Grotesk | Inter | JetBrains Mono | Techy, startup | Space Grotesk's quirky shapes lean "developer tool" rather than "hospital institution" |

Geist (Vercel) is also OFL ([licence](https://github.com/vercel/geist-font/blob/main/LICENSE.txt)). Keep the **app** on Inter so the dashboards do not change. The pairing applies to marketing and auth display type only.

### 5.2 Icons

- **Lucide** (already used): ISC licence; some icons derived from Feather under MIT. Both require keeping the copyright and licence notice in distributed copies, which the npm package does ([lucide.dev/license](https://lucide.dev/license)). Use a **single stroke width** (1.5 at large sizes) throughout marketing for a finer, more expensive look than the default 2.
- Alternatives if a finer set is wanted: Phosphor (MIT, has a "thin/light" weight), Tabler (MIT). Do not mix sets on one page.

### 5.3 Photography

| Source | Licence terms that matter | Caveats for a hospital product |
|---|---|---|
| **Unsplash** | "irrevocable, nonexclusive, worldwide copyright license ... including for commercial purposes, without permission from or attributing"; prohibited: compiling images to replicate a competing service, and selling images "without significant modification" ([unsplash.com/license](https://unsplash.com/license)). **Unsplash+ images are a separate paid licence** | The licence page does not address model or property releases. **A copyright licence is not a model release.** Identifiable patients or staff, and visible hospital names, logos or equipment brands, can imply endorsement |
| **Pexels** (current source, per `public/marketing/CREDITS.md`) | Free, attribution optional; not allowed: showing identifiable people "in a bad light or in a way that is offensive", implying "endorsement of your product by people or brands on the imagery", using images in a trademark, selling unaltered copies, redistributing on stock sites ([pexels.com/license](https://www.pexels.com/license/)) | Same release caveat. Several current images (ultrasound, operating room) show identifiable people and branded equipment |
| **randomuser.me** avatars (current testimonial faces) | Photos were "hand picked from the authorized section of UI Faces"; licensing is deferred to UI Faces, which says it no longer provides aggregated photos ([randomuser.me](https://randomuser.me/), [uifaces.co/licenses](https://uifaces.co/licenses)) | **Unclear provenance, and used here to depict fictional customers.** Remove regardless of licence |

**Photography guidance:** prefer (1) Callibrator's own product UI, (2) commissioned photos at a pilot hospital with signed releases from every identifiable person and the hospital's written permission, (3) stock only for non-identifying detail: hands on a reference instrument, a gauge face, a torque wrench, a test analyser screen with brands removed. NN/g's finding (§2.2) says real people and real product carry credibility; models do not.

### 5.4 Illustration, 3D, texture

- **unDraw**: commercial use without attribution; no compiling into a competing library ([undraw.co/license](https://undraw.co/license)). Its flat style reads "startup", not "grand"; use sparingly if at all.
- **Storyset (Freepik)**: free tier **requires visible attribution** with a link; removal needs Freepik Premium (search extract, [LicenseOrg](https://www.licenseorg.com/guide/design-graphics/storyset)). Avoid on a premium page.
- **Build the signature motif in-house as SVG**: graduation ticks, tolerance bands, a gauge needle, a certificate seal with a QR. Owned outright, tiny, themeable with the ADR-090 tokens, and animatable with CSS. Better than any stock illustration for "megah".
- **Grain and gradients**: generate a noise texture locally (an SVG `feTurbulence` filter or a small PNG produced in the build), and write gradients in CSS with `color-mix` over the theme tokens. No licence question arises.
- The hero currently has a **3D canvas** state. Weigh its bundle and main-thread cost against the Core Web Vitals of a first-visit marketing page; a high-resolution product render with one precise motion reads as more expensive than a spinning object.

---

## 6. Ranked Recommendations

Ranked by credibility risk removed first, then by premium effect per unit of effort. Each is a hypothesis for the design pass, not a decision.

### 6.1 Landing

1. **Take down every fabricated element now, before any redesign** (C1–C4, C7, C8, C11, and the HIPAA/SOC 2/SNARS chips). They are live, they depict fictional people and customers, and they carry legal as well as trust risk (UU 8/1999, FTC 16 CFR 465 by analogy). This is a copy deletion, not a design task.
2. **Change the conversion model to demo-led:** primary "Jadwalkan demo / Book a demo", secondary "Masuk / Sign in" in the header, and a WhatsApp contact for Indonesia. It matches every HTM competitor and Indonesian buying habits, and it removes the "free trial" promise.
3. **Make the real product the hero.** A large, crisp render of the real calibration entry or the signed certificate with its QR verification, on a deep-ink full-bleed band, labelled "sample data". This is the single biggest "megah" move, and the one competitors do not make well.
4. **One signature motif: metrology.** Graduation ticks, a tolerance band, a needle settling into range, drawn in SVG and used on the hero, section dividers, the auth panel and loading states. Delete the pulsing dot, magnetic button, gradient text, floating chips and count-up numbers.
5. **Rewrite the page into six sections, each one idea:** hero → the problem in the hospital's words (overdue devices found during a survey) → how it works (schedule, measure, sign, prove) → the proof artefacts (real certificate, audit trail, multi-site view) → standards we design for (text, no badges, verbs "supports" and "helps you prepare") → how we work with hospitals (pilot, rollout, support) → demo CTA.
6. **Type and colour:** pairing A (Plus Jakarta Sans display with Inter text), tabular figures, a light page with one dark grand band, one accent colour from the tokens, generous spacing.
7. **Bilingual, Indonesian first,** with Indonesian terms buyers use (alat kesehatan, kalibrasi, uji fungsi, survei akreditasi, IPSRS, ASPAK).
8. **Add a public, dated "Keamanan & Kepatuhan / Security & Compliance" page** that says what is true today (tenant isolation, MFA, SSO, audit trail, e-signature, data location) and what is planned, with dates. Link it from the header, as Ramp and Veeva do. It replaces badges with evidence.
9. **Pricing:** publish indicative prices or remove the tiers (Q2). A feature table with no prices is the least useful option.
10. **Accessibility:** no auto-moving content without a pause control (SC 2.2.2), reduced-motion variants for every animation, contrast from the ADR-090 tokens, one `<main>` and one `<h1>`.

### 6.2 Login

1. **Add `autocomplete` tokens** (`username` or `email`, `current-password`) to the sign-in form: a WCAG 2.1 AA (SC 1.3.5) failure fixed in minutes, and it makes password managers work.
2. **Add "Lupa kata sandi? / Forgot password?"** wired to the existing backend reset routes.
3. **Replace the two tabs with one identifier-first form:** email or username → Continue → password, or redirect to the tenant's SSO when the account or domain has it. Remove the SAML/OIDC choice from the user entirely.
4. **Support tenant-branded entry** (`/login?tenant=` or a tenant domain) that shows the hospital's name and logo, using the existing `useAuthBrand`.
5. **Keep TOTP as one pasteable field,** with the recovery-code option always visible.
6. **Premium styling that stays quiet:** the metrology motif on the brand panel, the real product glimpse, tabular figures, no marketing claims on the panel (C13).
7. **Errors:** one generic credential failure message, associated with the fields and focused on submit; a clear 429 message for rate limiting ("Terlalu banyak percobaan. Coba lagi dalam 5 menit.").
8. **Bilingual** with a visible switch.
9. **Passkey sign-in only once a pre-auth WebAuthn ceremony exists** (Q7); then autofill first (`autocomplete="username webauthn"`), a button second.

### 6.3 Register

1. **Stop promising a workspace the endpoint does not create** (C14 and the "Create a tenant workspace" link). Decide the model first (Q1).
2. **Default model: "Minta akses / Request access"** for organisations (organisation, facility type, city, device count, contact, work email, WhatsApp, explicit consent for the stated purpose under UU PDP), plus **invitation-based** staff accounts.
3. **If self-serve stays:** create a sandbox tenant with sample data and say so; use NIST password rules (length, blocklist, no composition rules, show-password, paste allowed) with helper text that says exactly that; neutral "check your email" response whether or not the address exists.
4. **`autocomplete` tokens** (`given-name`, `family-name`, `username`, `email`, `new-password`).
5. **Consent and privacy:** a link to the privacy notice and a consent checkbox that is not pre-ticked, naming the purpose (UU 27/2022 requires consent for specific, communicated purposes).
6. **Success state** that says what happens next, in how long, and whom to contact.

---

## 7. Evidence Callibrator Could Legitimately Show

Proof that is true today and needs no customer permission:

- **The artefacts themselves:** a sample certificate PDF with a working QR verification link; a sample audit trail; a sample e-signature record with meaning and time. Watermarked "CONTOH / SAMPLE".
- **Capability facts** as statements, not numbers: "SSO with SAML or OIDC", "MFA with an authenticator app", "Each hospital's data isolated per tenant", "Every change recorded with user and time", "Indonesian and English".
- **Transparency artefacts:** a dated changelog, a status page (if one exists), the security page (§6.1.8).
- **Later, with permission:** a pilot hospital's name, logo and a named, role-attributed quote; outcome numbers measured at that hospital, with the method and the Philips-style disclaimer.

---

## 8. Open Questions for the Owner

| # | Question | Why it blocks |
|---|---|---|
| Q1 | **What should `/register` be?** Public self-serve (and if so, does it create a tenant or a sandbox?), request-access only, or invitation only? | The register page's whole design, and its copy, depend on it. Today it creates a tenant-less user while promising a workspace |
| Q2 | **Will prices be published?** If yes, the indicative ranges and currency (IDR per facility per year?). If no, may the pricing section be removed? | The pricing section today has tiers with no prices and possibly unoffered enterprise items (on-premise, multi-region) |
| Q3 | **Are there any real customers or pilots** whose name, logo or quote may be used, with written permission? | Decides whether a social-proof section exists at all |
| Q4 | **Which standards should the page name,** and does a requirement-to-feature mapping exist for each (ISO/IEC 17025 clauses; the KMK 1128/2022 hospital accreditation standard, which chapter)? Should "SNARS" be retired from the product's compliance list (CLAUDE.md and `docs/`), which would need an ADR? | "Designed for X" is only credible if the mapping exists |
| Q5 | Which Indonesian regulation now governs periodic testing and calibration of medical devices (Permenkes 54/2015 is listed as no longer in force)? May counsel review the final copy? | Any regulation cited on the page must be current |
| Q6 | **Is the primary audience Indonesian hospitals only,** or also overseas? | Decides whether FDA 21 CFR Part 11 and GDPR appear on the main page or on a secondary "international" page |
| Q7 | **Is passkey sign-in (without a prior password) planned?** The current WebAuthn login endpoints appear to require a bearer token | Decides whether the login shows a passkey option |
| Q8 | **Which conversion channel does sales actually answer:** demo form, WhatsApp, email, phone? Who responds and how fast? | A premium page with an unanswered form is worse than a plain one |
| Q9 | **Tenant discovery:** will hospitals get their own login links or domains, or should the platform find the tenant from the email domain? | Decides the login architecture (3.2) and may need backend work |
| Q10 | **Which pairing** (A Jakarta precision, B editorial grand, C engineering institutional), and is a dark "grand" hero band on an otherwise light page acceptable? | Visual direction; worth two quick mock-ups shown to two or three hospital contacts |
| Q11 | Does the reference deployment actually do what the unrendered `SecuritySection` claims (backups, replication, DR drills, TLS 1.3)? | Decides what the security page may say |
| Q12 | May photography be commissioned at a pilot hospital, with releases? | The strongest premium and credibility asset available |

---

## 9. Sources

**Competitors**
- Nuvolo HTM: https://www.nuvolo.com/products/htm-asset-management/ ; platform background: https://www.nuvolo.com/what-is-connected-workplace-for-healthcare/
- Accruent TMS: https://www.accruent.com/products/tms ; https://www.accruent.com/solutions/healthcare-technology-management-software
- Blue Mountain: https://bluemountain.io/
- GAGEtrak: https://www.gagetrak.com/
- eMaint: https://www.emaint.com/
- MasterControl Asset Excellence (qualer.com redirect): https://www.mastercontrol.com/asset/
- Beamex CMX: https://www.beamex.com/software/beamex-cmx/
- IndySoft: https://www.indysoft.com/
- TMA Systems calibration (primetechpa.com redirect): https://tmasystems.com/solutions/calibration-management-software ; EQ2 acquisition: https://www.tmasystems.com/press/tma-systems-acquires-eq2-hems
- EQ2 HEMS: https://www.eq2llc.com/
- Calibration Control pricing (review site): https://www.softwareadvice.com/cmms/calibration-control-profile/ ; https://softwarefinder.com/facility-management-software/calibration-control
- PT GETS: https://gets.co.id/aplikasi-alat-kesehatan/
- SAMRS Cloud (search extract only): https://samrs.cloud/
- Indonesian SIMRS landscape: https://www.jurnal.id/id/software-rumah-sakit-berbasis-web/ ; https://www.hashmicro.com/id/hash-hospital ; https://sistemkesehatan.id/
- ASPAK: https://aspak.kemkes.go.id/ ; https://kms.kemkes.go.id/pengetahuan/detail/664ab3be296e6d2f6619c328
- Fluke Biomedical OneQA: https://www.flukebiomedical.com/oneqa

**Premium benchmarks**
- Linear: https://linear.app/
- Stripe: https://stripe.com/
- Ramp: https://ramp.com/
- Veeva: https://www.veeva.com/
- Philips Healthcare: https://www.usa.philips.com/healthcare
- LogRocket, "Linear design": https://blog.logrocket.com/ux-design/linear-design/
- Vercel Web Interface Guidelines: https://vercel.com/design/guidelines
- NN/g, Photos as Web Content: https://www.nngroup.com/articles/photos-as-web-content/
- NN/g, Trustworthiness in Web Design: https://www.nngroup.com/articles/trustworthy-design/
- NN/g, Show price on B2B sites: https://www.nngroup.com/articles/show-price/

**Authentication**
- NIST SP 800-63B-4: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- WCAG 2.2 SC 3.3.8: https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
- WCAG 2.1 SC 1.3.5: https://www.w3.org/WAI/WCAG21/Understanding/identify-input-purpose.html
- WCAG 2.1 SC 2.2.2: https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html
- Passkey Central (FIDO) sign-in pattern: https://www.passkeycentral.org/design-guidelines/required-patterns/sign-in-with-a-passkey ; FIDO guidelines announcement: https://fidoalliance.org/new-design-guidelines-optimizing-user-sign-in-experience-with-passkeys/
- Scalekit, universal vs org-specific login: https://www.scalekit.com/blog/designing-b2b-authentication-experiences-universal-vs-organization-specific-login
- Auth0 identifier-first: https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first
- Kinde home realm discovery: https://docs.kinde.com/authenticate/enterprise-connections/home-realm-discovery/
- SaaStr on self-serve B2B: https://www.saastr.com/prevalent-among-b2b-saas-startups-offer-self-service-signup-plans-e-g-no-sales-touch-sign-via-credit-card-percentage-b2b-saas-startups

**Claims and regulation**
- Fisher Phillips, "HIPAA Compliant" is not a certification: https://www.fisherphillips.com/en/insights/insights/how-healthcare-organizations-must-vet-ai-vendors-that-overstate-their-compliance
- HIPAA Vault: https://www.hipaavault.com/resources/what-does-hipaa-certified-mean/
- 21 CFR Part 11 vendor claims: https://trialtrack.net/blog/21-cfr-part-11-compliant-software/ ; https://www.acdlabs.com/blog/mythbusting-software-validation-gxp-and-21-cfr-part-11-compliance/
- ILAC R7 (MRA mark rules): https://european-accreditation.org/wp-content/uploads/2018/10/ILAC_R7_05_2015-Rules-for-the-Use-of-the-ILAC-MRA-Mark1.pdf ; PJLA accreditation claims SOP: https://www.pjlabs.com/downloads/SOP-3.pdf
- SOC 2 logo use: https://www.complyjet.com/blog/soc-2-badge-aicpa-logo-tips
- FTC fake reviews and testimonials rule: https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials ; Q&A: https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers ; eCFR: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465
- FTC Health Products Compliance Guidance: https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance
- UU 8/1999 Perlindungan Konsumen: https://regulasiku.id/content/UU_1999_08_Perlindungan-Konsumen.html ; https://peraturan.bpk.go.id/Details/45288/uu-no-8-tahun-1999
- Etika Pariwara Indonesia (superlatives), analysis: https://www.researchgate.net/publication/394263904_Analisis_Pelanggaran_Etika_Pariwara_Indonesia_EPI_dalam_Iklan_Produk_Komersial_Televisi
- UU 27/2022 Pelindungan Data Pribadi: https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022
- Permenkes 54/2015 (status): https://peraturan.go.id/id/permenkes-no-54-tahun-2015
- KMK HK.01.07/MENKES/1128/2022 Standar Akreditasi RS: https://keslan.kemkes.go.id/unduhan/fileunduhan_1654499045_682777.pdf ; KARS regulations: https://kars.or.id/daftar-regulasi/

**Assets**
- Unsplash licence: https://unsplash.com/license ; commercial-use FAQ: https://help.unsplash.com/en/articles/2612315-can-i-use-unsplash-images-for-commercial-purposes
- Pexels licence: https://www.pexels.com/license/
- Lucide licence: https://lucide.dev/license
- Plus Jakarta Sans: https://github.com/tokotype/PlusJakartaSans ; https://tokotype.github.io/plusjakarta-sans/
- Instrument Serif: https://github.com/Instrument/instrument-serif
- IBM Plex: https://github.com/IBM/plex
- Geist licence: https://github.com/vercel/geist-font/blob/main/LICENSE.txt
- unDraw licence: https://undraw.co/license
- Storyset licence guide: https://www.licenseorg.com/guide/design-graphics/storyset
- randomuser.me: https://randomuser.me/ ; UI Faces licences: https://uifaces.co/licenses

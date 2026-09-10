# FRONTEND.md — Frontend Plan: Immersive Revamp (Landing · Login · Register) + Blog & News

> **Scope of this document:** a detailed, execution-ready plan to revamp the **Landing page**, **Login**,
> and **Register** into an _immersive web_ experience — **behaviors, per-component animations,
> micro-animations, asset URLs (incl. 3D), and copy**. This is the **plan**; no code has been changed yet.
>
> **Design level chosen:** **Balanced immersive** — one lightweight WebGL 3D hero + animated mesh-gradient
> backgrounds + GSAP scroll-storytelling + calm micro-interactions. Auth pages stay **WebGL-3D-free**.
> **Hero centerpiece:** a **rotating 3D calibration instrument** that reacts to the cursor and
> **morphs to wireframe on scroll** (precision/measurement metaphor).
>
> **This document has two parts.** **Part I (§1–§10)** is the immersive Landing/Login/Register revamp.
> **Part II (§11–§22)** plans two new public pages — **Blog** and **News** — built near-term on **static
> TypeScript data files**, with a backend-CMS migration path (catalogued in [`MODULES.md`](../BACKEND/10-MODULE-REFERENCE.md) §7.3.M
> / §6.2 `content-cms`).
>
> **Product:** **HDC — Hospital Device Callibrator**, a multi-tenant medical-device calibration & compliance
> SaaS (ISO 17025 / HIPAA / KARS / SNARS; hospital biomedical & QA teams; Indonesia-focused). Tone:
> confident, editorial, anti-hype, compliance-first — **immersion must read as precision & trust, not
> spectacle.**

---

## 1. Design principles ("precision as immersion")

1. **Motion is an accent, not an obstacle.** Buyers scan for features/pricing — the immersive layer
   _rewards_ attention (hero, scroll story) but never blocks scanning. Research on award-winning B2B/health
   sites shows a _targeted_ immersive hero + performant restraint beats a fully-gamified page.
2. **Every effect maps to the product story.** Rotating instrument → _devices under management_; wireframe
   morph → _measurement/traceability_; check-draws → _audit-ready_; counters → _scale & compliance rate_.
3. **Brand-token driven.** All new visuals derive from `--primary` / `--accent` (indigo → violet) so the
   runtime **tenant branding** (`TenantBrandingProvider` sets `--primary` on `<html>`) still recolors them.
4. **Accessibility first.** Everything ships a `prefers-reduced-motion` static fallback (the codebase
   already gates all motion this way — preserve it).
5. **Performance budget is a feature.** Lazy WebGL, DPR cap, pause off-screen, poster fallbacks, keep the
   auth pages light (no 3D). Target: hero interactive < 2.5s on mid hardware; Lighthouse Perf ≥ 90 on
   landing, ≥ 95 on auth.

**Current state (baseline):** motion today is pure-CSS blurred orbs (`AnimatedBackground`,
`AuthBackground`), a hand-rolled `IntersectionObserver` (`ScrollReveal` → `[data-reveal]` → `.is-visible`),
`next/image` hover-zoom, and an SVG underline draw. **No 3D/WebGL and no animation libraries exist yet.**

---

## 2. Tech stack to add

> Modified **Next.js 16** (`next.config.ts` uses `cacheComponents` + a `next-bun-compile` Bun-binary
> adapter). **Read `node_modules/next/dist/docs/` before touching config/fonts/images.** All WebGL must be
> `dynamic(() => …, { ssr: false })` + `<Suspense>`. `new Date()` during render is disallowed.

| Purpose            | Package                                              | Link                                                                               | Notes for Next 16                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3D hero (renderer) | `three` + `@react-three/fiber` + `@react-three/drei` | https://r3f.docs.pmnd.rs · https://drei.docs.pmnd.rs                               | `'use client'`; load hero via `dynamic(ssr:false)`. Use drei `useGLTF`, `Environment`, `Float`, `Html`.                                                                                   |
| Optional bloom     | `@react-three/postprocessing`                        | https://github.com/pmndrs/react-postprocessing                                     | Subtle emissive glow on "measurement" points; perf-gate + off by default on low-end.                                                                                                      |
| Scroll animation   | `gsap` + ScrollTrigger + SplitText                   | https://gsap.com · https://gsap.com/docs/v3/Plugins/ScrollTrigger                  | **Now fully free** (incl. SplitText/ScrollSmoother). Use `@gsap/react` `useGSAP()`; register plugins client-side only.                                                                    |
| Smooth scroll      | `lenis`                                              | https://github.com/darkroomengineering/lenis                                       | `import { ReactLenis } from 'lenis/react'` in the landing shell; sync to ScrollTrigger via `lenis.on('scroll', ScrollTrigger.update)`. (The old `@studio-freight/*` package is retired.)  |
| UI motion          | `motion` (Framer Motion)                             | https://motion.dev                                                                 | Auth transitions, scroll progress, counters. Use `LazyMotion` + `domAnimation` to trim bundle.                                                                                            |
| Ambient gradient   | `@paper-design/shaders-react` **or** `whatamesh`     | https://shaders.paper.design/mesh-gradient · https://github.com/jordienr/whatamesh | Animated mesh-gradient behind hero + auth. **Paper Shaders** is a zero-dep React canvas component; **whatamesh** is Stripe's ~10kb WebGL gradient. No Three needed → safe for auth pages. |
| Lottie             | `@lottiefiles/dotlottie-react`                       | https://developers.lottiefiles.com                                                 | Register-success checkmark + calibration-sync loader.                                                                                                                                     |
| Marquee            | `react-fast-marquee` (or CSS keyframes)              | https://www.react-fast-marquee.com                                                 | Partner-logo + cert strip.                                                                                                                                                                |

**Micro-interactions** (magnetic buttons, tilt, spotlight, counters): hand-roll with GSAP `quickTo()` /
Framer `useMotionValue`, **or** copy-paste specific components (no dependency) from **React Bits**
(https://reactbits.dev), **Aceternity UI** (https://ui.aceternity.com), **Magic UI**
(https://magicui.design).

**Recommended minimal combo:** `three`+`@react-three/fiber`+`@react-three/drei` (hero only) · `gsap`
(+ScrollTrigger, SplitText) · `lenis` · `motion` · one gradient lib. That's the whole immersive layer.

---

## 3. Global systems

### 3.1 Smooth scroll (landing only)

Wrap the landing shell (`src/components/layouts/LandingLayout.tsx`) content in `<ReactLenis root>` and
initialize GSAP ScrollTrigger, syncing them:

```tsx
// LandingLayout (client). Lenis drives GSAP so pin/scrub stay in lockstep.
const lenis = useLenis((l) => ScrollTrigger.update());
useGSAP(() => {
  gsap.registerPlugin(ScrollTrigger, SplitText);
});
```

Keep the existing CSS `scroll-behavior: smooth; scroll-padding-top: 80px` as a no-JS fallback. **Do not**
apply Lenis to the dashboard or auth pages (forms + native inputs feel better without it).

### 3.2 Motion-token layer (add to `globals.css`)

Add a small token block so durations/easings are consistent and reduced-motion can zero them:

```css
@theme inline {
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out-quart: cubic-bezier(0.76, 0, 0.24, 1);
  --dur-fast: 220ms;
  --dur-base: 480ms;
  --dur-slow: 900ms;
  --stagger: 60ms;
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-fast: 0ms;
    --dur-base: 0ms;
    --dur-slow: 0ms;
  }
}
```

Reuse the **existing** keyframes (`fadeInUp`, `float`, `orbFloat*`, `gradientShift`, …) and `animate-*`
utilities where a CSS animation suffices — only reach for GSAP/Framer when scroll-scrub, pinning, split
text, or spring physics is required.

### 3.3 Reduced-motion strategy

- GSAP: wrap timelines in `gsap.matchMedia()` → `"(prefers-reduced-motion: no-preference)"` so they simply
  don't build for reduced-motion users.
- R3F hero: if `matchMedia('(prefers-reduced-motion: reduce)')` **or** WebGL unavailable → render the
  **poster image** instead of `<Canvas>`.
- Framer: gate variants on a `useReducedMotion()` check.

### 3.4 Performance budget (hard rules)

- **Lazy-load** the hero canvas: `dynamic(() => import('./HeroCanvas'), { ssr:false, loading: () => <HeroPoster/> })`, and only mount when the hero is near-viewport.
- **DPR cap:** `<Canvas dpr={[1, 1.75]}>`; drop to `1` on `navigator.hardwareConcurrency <= 4`.
- **Pause off-screen:** `frameloop="demand"` + invalidate on interaction/scroll, or pause when the hero
  leaves the viewport (IntersectionObserver).
- **Model budget:** target `.glb` ≤ ~1.5 MB (Draco/meshopt compressed); 1 HDRI ≤ ~1 MB (or use drei
  `Environment preset`). Dispose geometries/materials on unmount.
- **Auth pages:** **no `three`/R3F** — gradient via CSS/`whatamesh` canvas only. Keep TTI unaffected.
- Split immersive libs out of the shared bundle so the dashboard never ships them.

---

## 4. Landing page — section-by-section

Route: `src/app/page.tsx` → `LandingLayout` → sections (in order): **Hero, Trust, HowItWorks, Features,
Platform, Compliance, Testimonials, Pricing, CTA** + `Navigation` + `Footer`. Copy/data lives in
`src/data/landing.ts`. Shared primitives in `src/components/landing/_shared/` (`Eyebrow`, `SectionHeading`,
`Underline`, `MediaFrame`, `ScrollReveal`). _(Note: `SecuritySection.tsx` is orphaned — delete or fold into
Compliance during the build.)_

Format per section: **Behavior → Entrance → On-scroll → Micro-interactions → Assets → Copy.**

### 4.0 Navigation — `src/components/layouts/Navigation.tsx`

- **Behavior:** fixed; transparent → `bg-background/80 backdrop-blur-xl` after `scrollY>20` (keep).
- **Entrance:** wordmark + links fade/slide down (`--dur-base`, stagger 40ms).
- **On-scroll:** a **1px scroll-progress bar** (Framer `useScroll → scaleX`) pinned under the nav; the
  active section link gets an animated underline (ScrollTrigger `onToggle`).
- **Micro:** **magnetic** "Get Started" CTA (translate toward cursor within ±8px, GSAP `quickTo`); links
  hover-underline wipe.
- **Assets:** none (Shield-in-gradient wordmark).
- **Copy:** brand `HDC`; links `Features · Compliance · Platform · Pricing`; actions `Sign In` · `Get Started`.

### 4.1 Hero — `src/components/landing/HeroSection.tsx` ★ centerpiece

- **Behavior:** two-column. Left = pitch; **Right = live 3D calibration instrument** (replaces the static
  `/marketing/hero-clinician.jpg` `MediaFrame`). A low-opacity animated **mesh-gradient** wash sits behind,
  tinted from `--primary`.
- **The 3D scene (`HeroCanvas.tsx`, `ssr:false`):**
  - A **rotating calibration instrument** `.glb` (`useGLTF`) — e.g. a digital caliper / multimeter / gauge —
    on a slow idle **auto-rotate** (drei `<Float>` + a gentle `useFrame` y-rotation).
  - **Cursor-reactive:** the model tilts/parallaxes toward the pointer (lerp rotation to `pointer.x/y`,
    max ±12°). Subtle depth-of-field/vignette optional.
  - **Scroll-scrubbed wireframe morph:** as the hero scrolls out, GSAP ScrollTrigger `scrub` drives a
    uniform that **cross-fades the solid material to a glowing wireframe** with emissive "measurement"
    points lighting up along edges (the _precision/traceability_ beat). Lighting via drei `<Environment>`
    (Poly Haven HDRI or a preset).
  - **Fallback:** `HeroPoster` (the existing hero photo or a pre-rendered instrument still) for
    reduced-motion, no-WebGL, and the pre-hydration/loading state.
- **Entrance (text side):** eyebrow fade; **headline via GSAP SplitText** (mask-reveal per line, then per
  word stagger `--stagger`); subhead fade-up `delay 150ms`; CTA row fade-up; reassurance line fade.
- **On-scroll:** the 3D morph (above) + a soft parallax on the floating annotation chips.
- **Micro:** **animated stat counters** (`12,000+`, `40%`, `99.2%`) count up when in view (Framer
  `useInView` + `animate`); floating chips (`99.2% on schedule`, `Audit-ready`) bob on a Framer spring;
  **magnetic** primary CTA; an animated scroll-cue chevron at the bottom.
- **Assets:** instrument `.glb` (see §6); HDRI (see §6); mesh-gradient (see §6); poster image.
- **Copy (keep, kinetic-ready):**
  - Eyebrow: `ISO 17025 · Multi-tenant · Built for hospitals`
  - Headline: **Every device calibrated. Every audit, _already ready._** _(underline animates the last words)_
  - Subhead: _HDC brings your whole fleet of medical instruments into one place — it schedules the work,
    captures readings against traceable standards, and issues the signed certificates your assessors expect._
  - CTAs: **Start free trial** → `/login` · **See how it works** → `#how-it-works`
  - Reassurance: `No credit card required · 14-day free trial · HIPAA-ready`
  - _(Alt headlines in §7.)_

### 4.2 Trust — `src/components/landing/TrustSection.tsx`

- **Behavior:** `border-y bg-muted/40` band with a partner wordmark strip + certification chips.
- **Entrance:** label fade; chips fade-scale stagger (keep `--reveal-delay`).
- **On-scroll:** **infinite marquee** of partner wordmarks (`react-fast-marquee`, pause-on-hover,
  grayscale → color on hover).
- **Micro:** cert chips (`ISO 17025 · HIPAA · KARS · SNARS · SOC 2`) lift on hover with a tooltip.
- **Assets:** monochrome partner wordmarks (SVG/text — placeholders today).
- **Copy:** `Trusted by biomedical & quality teams across healthcare`.

### 4.3 How It Works — `src/components/landing/HowItWorksSection.tsx` (`#how-it-works`)

- **Behavior:** the flagship **scroll-story**. Convert the alternating rows into a **pinned sticky-scroll**:
  the section pins while the four steps advance.
- **Entrance:** heading SplitText reveal.
- **On-scroll (GSAP ScrollTrigger `pin:true`, `scrub`):** a **vertical progress line draws** top→bottom as
  you scroll; each step (`01 Bring your fleet into one place → 04 Sign, certify, and archive`) fades/locks
  in as its segment fills; the **right-hand device visual swaps per step** (image cross-fade, or reuse the
  hero instrument in a mini-canvas showing the relevant state).
- **Micro:** step numbers count/scale; the active step title gets the animated `Underline`.
- **Assets:** 4 step images (existing `MediaFrame` photos) or a small looping device render.
- **Copy:** heading `From loading dock to signed certificate — four steps.`; steps 01–04 (keep); trailing
  link `See everything the platform does` → `#features`.

### 4.4 Features (bento) — `src/components/landing/FeaturesSection.tsx` (`#features`, `bg-muted/40`)

- **Behavior:** 3-col **bento grid** of 6 `FeatureCell`s + one tall image cell + one accent statement cell.
- **Entrance:** cells reveal in a masonry stagger (batch ScrollTrigger, `--stagger`).
- **On-scroll:** the accent `bg-primary` cell ("Inside tolerance, on time.") runs a slow **gradient shift**
  (existing `animate-gradient`).
- **Micro:** **cursor spotlight** follows the pointer across the grid (radial highlight that tracks
  `mousemove`); **tilt-on-hover** per card (`react-parallax-tilt` or a small transform); icon micro-bounce;
  the tall image cell does a `clip-path` reveal.
- **Assets:** `/marketing/feature-monitoring.jpg`; `lucide-react` icons.
- **Copy:** heading `The tools a biomedical team actually _reaches for._`; feature titles (keep): Device
  lifecycle end to end · Scheduling that stays ahead · Certificates auditors accept · Notifications that
  matter · Multi-tenant by design · Reporting leadership reads.

### 4.5 Platform — `src/components/landing/PlatformSection.tsx` (`#platform`)

- **Behavior:** left = the dashboard screenshot in a fake browser frame; right = capabilities list.
- **Entrance:** the browser frame scales/fades in; capabilities slide from the right, stagger.
- **On-scroll:** the dashboard image **parallaxes in depth** (subtle `translateY`/`rotateX` on scroll,
  Framer `useTransform`); a soft `--primary` glow behind it.
- **Micro:** **orbiting "device status chips"** float around the frame (green "In tolerance" / amber
  "Due soon") with a live **pulse dot**; capability rows check-in on hover.
- **Assets:** `/marketing/platform-dashboard.jpg`.
- **Copy:** heading `One console for every facility you run.`; capabilities (keep): Digital certificates &
  records · Real-time device status · Multi-region ready · API-first architecture.

### 4.6 Compliance — `src/components/landing/ComplianceSection.tsx` (`#compliance`, `bg-muted/40`)

- **Behavior:** left checklist; right image with an "Audit prep · Days → minutes" chip; accreditation cards.
- **Entrance:** heading SplitText.
- **On-scroll:** checklist items **check-draw** sequentially (animated SVG stroke or a small Lottie
  checkmark per item) as they enter; the "Days → minutes" is an **animated counter** (e.g. `14 → 0.2`).
- **Micro:** accreditation cards (`ISO 17025 · KARS · SNARS · HIPAA`) flip/scale on hover.
- **Assets:** `/marketing/compliance-audit.jpg`; checkmark Lottie (see §6).
- **Copy:** heading `Walk into the audit already prepared.`

### 4.7 Testimonials — `src/components/landing/TestimonialsSection.tsx` (`#testimonials`)

- **Behavior:** one featured quote + 3 cards.
- **Entrance:** featured quote fades; the **large quotation mark draws** (SVG stroke).
- **On-scroll:** optional auto-advancing / drag carousel for the small cards (Framer drag).
- **Micro:** star rows **fill** left-to-right on view; card hover lift.
- **Assets:** avatars (placeholder).
- **Copy:** heading `What teams say after they make the switch.` _(all quotes are illustrative placeholders.)_

### 4.8 Pricing — `src/components/landing/PricingSection.tsx` (`#pricing`, `bg-muted/40`)

- **Behavior:** 3 tiers (Starter / **Professional** featured / Enterprise).
- **Entrance:** cards rise + fade, stagger; the featured card gets a persistent **glow ring**.
- **On-scroll:** feature rows slide-in with per-row delay (keep the existing hover slide).
- **Micro:** a **monthly/annual toggle** that animates the **price with a counter** (roll digits);
  cards lift on hover; the featured card's glow intensifies on hover.
- **Assets:** none.
- **Copy:** heading `Plans that scale with your fleet.`; CTAs `Start free trial` / `Contact sales`.

### 4.9 CTA — `src/components/landing/CtaSection.tsx` (`#cta`)

- **Behavior:** full-bleed dark photo band with brand-tinted overlays.
- **Entrance:** heading SplitText; sub + CTAs fade-up (keep `--reveal-delay`).
- **On-scroll:** the background image **parallaxes**; a slow diagonal **gradient sheen** sweeps across.
- **Micro:** both buttons **magnetic**; trust ticks fade in.
- **Assets:** `/marketing/cta-band.jpg`.
- **Copy:** heading `Make your next audit the boring one.`; sub _"Bring every device, schedule, and
  certificate into one place — and hand your assessors a folder that's already complete."_; CTAs
  `Start free trial` · `Book a walkthrough`; ticks `No credit card required · 14-day free trial · Cancel anytime`.

### 4.10 Footer — `src/components/layouts/Footer.tsx`

- Subtle reveal-up of columns; keep the `useEffect` year. No heavy motion.

---

## 5. Login & Register (WebGL-3D-free — keep TTI low)

Files: `src/app/login/page.tsx` (+ `components/`, `hooks/`), `src/app/register/page.tsx` (+ `components/`),
shared `src/components/auth/*` (`AuthBackground`, `AuthBrandingPanel`, `BrandMark`, `Spinner`). **Preserve
the per-tenant branding pipeline** (`useAuthBrand`, `TenantBrandingProvider` sets `--primary`; the
`X-Tenant-ID` proxy header) and all `prefers-reduced-motion` fallbacks.

- **Background:** replace the CSS blurred orbs (`AuthBackground`) with a **calm animated mesh-gradient**
  (`whatamesh` canvas or Paper Shaders `<MeshGradient/>`), tinted from `--primary`/`--accent` so tenant
  branding still recolors it. Very low motion, no 3D. Reduced-motion → a static mesh PNG (CSS Hero Mesher).
- **Branding photo panel (`AuthBrandingPanel`, desktop):** subtle **Ken-Burns** slow zoom/pan +
  a thin animated gradient tint overlay; brand mark/name/tagline fade-up in sequence; trust points
  (`ISO 17025 · Signed certificates · HIPAA-ready`) stagger in.
- **Card (Framer Motion):** entrance = scale(0.97→1) + fade (`--dur-base`, ease-out-expo); the
  **Password ↔ Enterprise SSO tab** switch uses a Framer `layout`/`AnimatePresence` slide+fade (animate the
  active-tab underline with `layoutId`).
- **Fields:** staggered reveal on mount; input **focus micro-motion** (label lift + border-glow from
  `--primary`); password show/hide icon morph; the submit button is **magnetic** with an inline
  loading state.
- **Register success (`RegisterSuccessPanel`):** swap the static state for a **Lottie checkmark** (draws on)
  - the "Check your email" copy fading up beneath it. Login/submit spinner → a **Lottie calibration-sync**
    loader (optional).
- **Copy (keep):** Login — eyebrow `Sign in`, `Welcome back`, "Sign in to your account to continue",
  footer `Create a tenant workspace` → `/register`. Register — eyebrow `Get started`, `Create your account`.
  SSO field: `Tenant Code` (placeholder `e.g. hca-group`) → "Proceed to Identity Provider".

---

## 6. Asset library (with URLs)

### 6.1 3D models (free / CC — export `.glb`)

- **Poly Pizza** (free low-poly, no login): https://poly.pizza/search/medical · https://poly.pizza/search/medicine · explore https://poly.pizza/explore (hosts the archived **Google Poly** set).
- **Sketchfab** (600k+ free, filter **Downloadable + Free + CC0/CC-BY**): https://sketchfab.com/features/free-3d-models · license-filter guide https://sketchfab.com/blogs/community/refine-downloadable-model-searches-with-new-license-filters/ · glTF/GLB export on all downloadable models https://sketchfab.com/features/gltf
- **Quaternius** (CC0, game-ready): https://quaternius.com
- **Kenney** (CC0, incl. geometric/UI kits): https://kenney.nl/assets
- **Spline community** (embed instead of `.glb`): https://spline.design · community https://app.spline.design/community — embed via `@splinetool/react-spline/next` (`<Spline scene="…/scene.splinecode" />`) or `<spline-viewer url="…">`. If CORS blocks, download the `.splinecode` and self-host under `/public`.
- **Candidate hero models:** digital **caliper**, **multimeter**, **oscilloscope**, **pressure gauge/dial**, **ultrasound probe** — pick one that reads instantly as "precision instrument." Optimize with `gltf-transform` (Draco/meshopt) to ≤ ~1.5 MB.

### 6.2 Lighting (HDRI) & textures

- **Poly Haven** (CC0): HDRIs https://polyhaven.com/hdris (studio/warehouse), textures https://polyhaven.com/textures, models https://polyhaven.com/models. _(Or skip a file and use a drei `<Environment preset="studio" />`.)_

### 6.3 Mesh / gradient backgrounds

- **whatamesh** (Stripe-style animated WebGL, ~10kb): https://meshgradient.com · https://github.com/jordienr/whatamesh
- **Paper Shaders** (React canvas components, zero-dep): https://shaders.paper.design/mesh-gradient · https://github.com/paper-design/shaders
- **ShaderGradient** (configurable WebGL, R3F-based): https://shadergradient.co
- **Static fallbacks** (CSS/PNG): CSS Hero Mesher https://csshero.org/mesher/ · Colorffy https://colorffy.com/mesh-gradient-generator

### 6.4 Lottie (micro-animations)

- Medical: https://lottiefiles.com/free-animations/medical · Medical loading: https://lottiefiles.com/free-animations/medical-loading
- Checkmark: https://lottiefiles.com/free-animations/check-mark · Checkmark loader: https://lottiefiles.com/free-animations/checkmark-loader
- Use for: register/login success, calibration-sync loaders, subtle inline compliance icons.

### 6.5 Reference sites (technique study — not for copying)

- **Igloo Inc** https://www.igloo.inc (Awwwards Site of the Year — full WebGL, scroll-driven camera).
- **Terminal Industries** https://terminal.industries (scroll transitions a 3D model into **wireframe** — the exact hero metaphor here).
- **Scout Motors** https://scoutmotors.com (3D product exploration/configurator).
- **Cartier — Watches & Wonders** https://www.cartier.com/en-us/watches-and-wonders (sticky-scroll 3D "alcoves" — the How-It-Works pattern).
- **Contra biotech WebGL hero** https://contra.com/community/bw8iy4sD-dynamic-web-gl-hero-section-design-with (mouse-reactive point-cloud — alt hero if the `.glb` route stalls).
- **Microsoft AI** https://microsoft.ai (calm, trustworthy immersive tone).
- **Oryzo** https://oryzo.ai (single-object inertia hero — close to our restraint level).
- Galleries to keep mining: Awwwards WebGL https://www.awwwards.com/websites/webgl/ · 3D https://www.awwwards.com/websites/3d/ · Saaspo scroll-animations https://saaspo.com/style/scroll-animations · Lapa Ninja 3D https://www.lapa.ninja/category/3d-websites/ · Dribbble medtech https://dribbble.com/search/medtech-landing-page.

### 6.6 Component references (copy-paste, no heavy deps)

React Bits https://reactbits.dev · Aceternity UI https://ui.aceternity.com · Magic UI https://magicui.design (magnetic buttons, spotlight/tilt cards, marquee, counters, split-text).

---

## 7. Copy deck

The existing voice (in `src/data/landing.ts`) is strong — **keep it** and layer kinetic reveals on top.
Full deck to lock at build time:

| Section      | Element        | Copy                                                                                                                                                                                                  |
| ------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero         | Eyebrow        | `ISO 17025 · Multi-tenant · Built for hospitals`                                                                                                                                                      |
| Hero         | **Headline**   | **Every device calibrated. Every audit, _already ready._**                                                                                                                                            |
| Hero         | Headline alt 1 | **Your whole fleet, calibrated. Your next audit, already done.**                                                                                                                                      |
| Hero         | Headline alt 2 | **Precision you can prove. Audits you can skip the panic for.**                                                                                                                                       |
| Hero         | Subhead        | _HDC brings your whole fleet of medical instruments into one place — it schedules the work, captures readings against traceable standards, and issues the signed certificates your assessors expect._ |
| Hero         | CTAs           | **Start free trial** · **See how it works**                                                                                                                                                           |
| Hero         | Reassurance    | `No credit card required · 14-day free trial · HIPAA-ready`                                                                                                                                           |
| Trust        | Label          | `Trusted by biomedical & quality teams across healthcare`                                                                                                                                             |
| How It Works | Heading        | `From loading dock to signed certificate — four steps.`                                                                                                                                               |
| How It Works | Steps          | `01 Bring your fleet into one place` · `02 Let schedules run themselves` · `03 Capture readings at the bench` · `04 Sign, certify, and archive`                                                       |
| Features     | Heading        | `The tools a biomedical team actually _reaches for._`                                                                                                                                                 |
| Platform     | Heading        | `One console for every facility you run.`                                                                                                                                                             |
| Compliance   | Heading        | `Walk into the audit already prepared.`                                                                                                                                                               |
| Compliance   | Chip           | `Audit prep · Days → minutes`                                                                                                                                                                         |
| Testimonials | Heading        | `What teams say after they make the switch.`                                                                                                                                                          |
| Pricing      | Heading        | `Plans that scale with your fleet.`                                                                                                                                                                   |
| CTA          | Heading        | `Make your next audit the boring one.`                                                                                                                                                                |
| CTA          | Sub            | _Bring every device, schedule, and certificate into one place — and hand your assessors a folder that's already complete._                                                                            |
| CTA          | CTAs           | **Start free trial** · **Book a walkthrough**                                                                                                                                                         |
| Login        | Heading        | `Welcome back`                                                                                                                                                                                        |
| Register     | Heading        | `Create your account`                                                                                                                                                                                 |

_Microcopy:_ keep it plain and reassuring — button loading = "Signing you in…", success = "You're all set.",
error toasts stay specific. Metrics/partners/testimonials are **illustrative placeholders** — replace with
real numbers before launch.

---

## 8. Motion spec reference

| Token                       | Value                                           | Use                            |
| --------------------------- | ----------------------------------------------- | ------------------------------ |
| Easing (reveal)             | `cubic-bezier(0.16, 1, 0.3, 1)` (out-expo)      | fades, slides, counters        |
| Easing (morph/pin)          | `cubic-bezier(0.76, 0, 0.24, 1)` (in-out-quart) | hero wireframe, sticky scroll  |
| Duration fast / base / slow | 220 / 480 / 900 ms                              | micro / entrances / hero morph |
| Stagger                     | 60 ms (list) · 30 ms (split-text words)         | grids, headlines               |
| Magnetic pull               | max 8px (buttons) / 12° (hero tilt), lerp 0.15  | CTAs, hero                     |
| Counter                     | 1.2s, ease-out, `useInView` once                | stats, pricing, "days→minutes" |
| Parallax                    | ±24px translate on scroll                       | platform image, CTA band       |
| DPR                         | `[1, 1.75]` (→ 1 on ≤4 cores)                   | R3F canvas                     |

Reduced-motion collapses all of the above to `0ms` / no-op and renders the hero **poster**.

---

## 9. Accessibility & performance guardrails

- **Reduced motion:** `gsap.matchMedia()`, Framer `useReducedMotion()`, and a hero poster fallback — no
  parallax, no autoplay, no counters that move.
- **Keyboard/focus:** magnetic/tilt effects must never trap focus or shift layout; visible focus rings
  preserved (`--ring`); tab order unchanged.
- **Contrast:** all text stays on `--card`/`--background` surfaces (not over busy 3D) at AA; gradient/3D are
  **behind** content with sufficient overlay.
- **No CLS:** reserve the hero canvas area (aspect box) so the poster→canvas swap doesn't shift layout.
- **Perf:** lazy WebGL (`ssr:false` + near-viewport mount), DPR cap, `frameloop="demand"`/pause off-screen,
  dispose on unmount, compressed `.glb`/HDRI, `LazyMotion` for Framer, immersive libs code-split away from
  the dashboard bundle. **Auth pages carry zero 3D.**
- **Tenant branding:** every gradient/glow/accent derives from `--primary`/`--accent` so
  `TenantBrandingProvider` recoloring still works; verify with 2–3 tenant primary colors.
- **Theming:** validate light **and** dark (`.dark`) for every new surface.

---

## 10. Phased implementation roadmap (for the later build pass)

1. **Foundation** — add libs; wrap landing in `<ReactLenis>`; register GSAP plugins; add the motion-token
   block to `globals.css`; wire `prefers-reduced-motion` plumbing. _Verify:_ landing still builds + scrolls;
   dashboard/auth bundles unchanged.
2. **Hero 3D** — source + optimize a `.glb` (or a Spline scene); build `HeroCanvas` (auto-rotate, cursor
   tilt, `<Environment>`), the scroll-scrubbed wireframe morph, and the `HeroPoster` fallback. _Verify:_
   lazy-loads, reduced-motion shows poster, no CLS, DPR capped.
3. **Scroll story** — pin/scrub How-It-Works; SplitText headings across sections; animated counters;
   replace/augment the `data-reveal` reveals with ScrollTrigger batches.
4. **Micro-interactions** — magnetic buttons, spotlight+tilt feature cells, Trust marquee, nav scroll
   progress, Platform parallax + orbiting chips, Compliance check-draws, Pricing toggle/counter.
5. **Auth revamp** — mesh-gradient background (brand-tinted), Framer card/tab transitions, Lottie
   success/loader; keep it 3D-free. _Verify:_ auth TTI + tenant branding intact.
6. **Polish + perf** — reduced-motion audit, DPR/bundle/TTI, cross-theme, tenant-color check, and the
   **`npm run build` (bun-compile)** build; Lighthouse (landing ≥ 90, auth ≥ 95).

---

_Part I targets the real files: landing `src/app/page.tsx` + `src/components/landing/*` + shell
`src/components/layouts/LandingLayout.tsx`; auth `src/app/login`, `src/app/register`,
`src/components/auth/*`; tokens/animation in `src/app/globals.css`; copy in `src/data/landing.ts`; branding
via `src/components/TenantBrandingProvider.tsx` + `src/app/api/v1/[...path]/route.ts` (`X-Tenant-ID`). It
preserves the modified-Next-16 constraints (`cacheComponents`, bun-compile, `ssr:false` for WebGL) and the
existing `prefers-reduced-motion` discipline._

---

# Part II — Public Blog & News Pages

> **Scope of Part II:** an execution-ready plan for two new **public marketing pages** — **Blog** (long
> editorial / thought-leadership articles) and **News** (short, dated product & company updates). This is the
> **plan**; no page code has been written yet.
>
> **Content source (near-term):** **static TypeScript data files** (`src/data/blog.ts`, `src/data/news.ts`),
> mirroring the existing `src/data/landing.ts`. **No backend/CMS is built in this near-term phase.** The
> eventual **Backend CMS module** is catalogued in [`MODULES.md`](../BACKEND/10-MODULE-REFERENCE.md) §7.3.M (`content-cms`); §21
> below documents the static → CMS migration path so both states stay consistent.

---

## 11. Blog & News — overview & goals

- **Two public routes**, reachable from the marketing nav & footer:
  - **`/blog`** — a card grid of articles + `/blog/[slug]` detail pages. Long-form, evergreen, SEO-driven.
  - **`/news`** — a compact, reverse-chronological feed + `/news/[slug]` detail pages. Short dated updates.
- **Consistent with the landing chrome** — both wrap content in `<LandingLayout>` so they inherit
  `Navigation`, `Footer`, the animated background, and the `ScrollReveal` system for free.
- **SEO-first** — unlike today's all-`"use client"` pages (which cannot export metadata), the new page
  files are **Server Components** with `generateMetadata` + `generateStaticParams`, a `sitemap.ts`, and
  JSON-LD. This is the single most important structural decision here.
- **Tenant-brand-aware** — everything uses semantic tokens (`bg-card`, `text-foreground`, `bg-primary`), so
  `TenantBrandingProvider`'s runtime `--primary` override recolors it automatically.
- **News mirrors Blog** — the two share components and data patterns; Blog is specified in full and News is
  the lighter variant (§14.3). Build Blog first, then News.

**Baseline (confirmed by exploration):** greenfield — no blog/news/article/CMS anywhere in the repo. Landing
copy is hard-coded in `src/data/landing.ts`; public routing is **flat** (no route groups, no nested
`layout.tsx`); layout is applied per-page by wrapping JSX in `<LandingLayout>`. The Footer "Company" column
already contains a **dead `#` "Blog" link** — this plan gives it a real destination.

---

## 12. Routes & file structure (App Router, flat)

```
frontend/src/app/
  blog/
    page.tsx              # Blog index (Server Component) — list + featured + filters
    [slug]/page.tsx       # Blog article detail (Server Component)
  news/
    page.tsx              # News index (Server Component) — dated feed
    [slug]/page.tsx       # News item detail (Server Component)
  sitemap.ts             # (new) enumerate /blog/* and /news/* + core routes
frontend/src/data/
  blog.ts                # (new) typed posts + access helpers
  news.ts                # (new) typed news items + access helpers
frontend/src/components/blog/          # (new) shared blog/news UI
  PostCard.tsx  PostMeta.tsx  ArticleBody.tsx  CategoryFilter.tsx
  ShareRow.tsx  RelatedPosts.tsx  NewsList.tsx
frontend/public/blog/                  # (new) cover images (+ CREDITS.md)
frontend/public/news/                  # (new) cover images (+ CREDITS.md)
```

**Server vs Client split (deliberate departure from the existing all-client pages):**

- `page.tsx` files stay **Server Components** → they can `export const metadata` / `generateMetadata`,
  `generateStaticParams`, and render statically for SEO. They import data from `src/data/*` directly (no API
  call) and render the list/article markup.
- Interactivity lives in small **`"use client"`** children: `CategoryFilter` (chips + `?category=`),
  `ShareRow` (Web Share / copy-link), and any "load more" control. Wrap search-param-reading UI in
  `<Suspense>` (mirrors how `login`/`register` wrap search-param hooks today).
- `<LandingLayout>` is `"use client"`; a Server Component may render a Client Component as a wrapper, so
  `page.tsx` (server) → `<LandingLayout>` (client) → server-rendered children composes fine.

> **Next 16 reminder:** this is a modified Next (`cacheComponents: true`, `next-bun-compile`). **Read the
> relevant guide in `node_modules/next/dist/docs/` before touching `next.config.ts`, fonts, or images.**
> Do **not** call `new Date()` during render (see `Footer.tsx`); precompute all dates as strings in the data
> files. Wrap `?page=`/`?category=`-reading UI in `<Suspense>`.

---

## 13. Data shape (`src/data/blog.ts` / `src/data/news.ts`)

Follow the `landing.ts` convention: typed interfaces + exported arrays, `LucideIcon` refs inline, **all dates
precomputed as strings** (never derived at render). Body is a small typed **block** array so the same shape
maps cleanly to a future CMS rich-text field (§21).

```ts
// src/data/blog.ts
import type { LucideIcon } from "lucide-react";

export type BlogCategory = "Compliance" | "Calibration" | "Product" | "Company";

export interface Author { name: string; role: string; avatar: string; }

// Discriminated block union — renders in ArticleBody; CMS-portable.
export type ArticleBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "quote"; text: string; cite?: string }
  | { type: "image"; src: string; alt: string; caption?: string; aspect?: string };

export interface BlogPost {
  slug: string;               // stable, URL-safe — survives the CMS migration
  title: string;
  excerpt: string;            // list card + meta description
  cover: string;              // /blog/*.jpg (local public/)
  coverAlt: string;
  category: BlogCategory;
  author: Author;
  publishedAt: string;        // ISO "2026-06-18" — PRECOMPUTED, never new Date() in render
  publishedLabel: string;     // "June 18, 2026" — precomputed display string
  readingMinutes: number;
  featured?: boolean;         // index hero
  body: ArticleBlock[];
}

export const blogPosts: BlogPost[] = [ /* §20 copy deck */ ];
export const blogCategories: BlogCategory[] = ["Compliance", "Calibration", "Product", "Company"];

// Access helpers — the single seam the CMS migration swaps to API calls (§21).
export const getAllPostSlugs = () => blogPosts.map((p) => p.slug);
export const getPostBySlug = (slug: string) => blogPosts.find((p) => p.slug === slug) ?? null;
export const getPostsByCategory = (c?: BlogCategory) =>
  c ? blogPosts.filter((p) => p.category === c) : blogPosts;
export const getFeaturedPost = () => blogPosts.find((p) => p.featured) ?? blogPosts[0];
export const getRelatedPosts = (slug: string, limit = 3) => {
  const cur = getPostBySlug(slug);
  return blogPosts.filter((p) => p.slug !== slug && p.category === cur?.category).slice(0, limit);
};
```

```ts
// src/data/news.ts  (lighter)
export type NewsTag = "Product" | "Company" | "Compliance" | "Release";
export interface NewsItem {
  slug: string; title: string; summary: string;
  date: string;        // ISO, precomputed
  dateLabel: string;   // "July 2, 2026", precomputed
  tag: NewsTag;
  body: ArticleBlock[]; // reuse the Blog block union
}
export const newsItems: NewsItem[] = [ /* §20 */ ];
export const getAllNewsSlugs = () => newsItems.map((n) => n.slug);
export const getNewsBySlug = (slug: string) => newsItems.find((n) => n.slug === slug) ?? null;
```

_(Import `ArticleBlock`/`Author` into `news.ts` from `blog.ts` to keep one source of truth.)_

---

## 14. Page-by-page spec

Format: **Behavior → Layout → Components → Animation → Copy.**

### 14.1 Blog index — `src/app/blog/page.tsx`

- **Behavior:** Server-rendered list of all posts; a client `CategoryFilter` narrows by `?category=`; optional
  "Load more" (client) beyond the first N. Above-the-fold featured post highlighted.
- **Layout:** `<LandingLayout>` → page header (`Eyebrow` "Blog" + `SectionHeading`) → **featured post band**
  (large `MediaFrame` cover + title + excerpt + `PostMeta`) → `CategoryFilter` chips → responsive
  `PostCard` grid (`grid sm:grid-cols-2 lg:grid-cols-3 gap-8`) → pagination/load-more.
- **Components:** `Eyebrow`, `SectionHeading`, `Underline` (reused `_shared`); new `PostCard`, `PostMeta`,
  `CategoryFilter`.
- **Animation:** cards use `data-reveal` for the staggered IntersectionObserver entrance (already in
  `globals.css`, gated behind `prefers-reduced-motion`); featured cover uses the `MediaFrame` hover-zoom;
  filter chips get an active-state transition. No new libraries.
- **Copy:** header `Field notes on calibration, compliance, and keeping a hospital audit-ready.` (see §20).

### 14.2 Blog detail — `src/app/blog/[slug]/page.tsx`

- **Behavior:** `generateStaticParams()` from `getAllPostSlugs()`; `generateMetadata({ params })` from the
  post; `getPostBySlug` → `notFound()` if missing. Renders the article + related posts + CTA.
- **Layout:** back-link (`← All articles`) → category chip + `SectionHeading` title + `PostMeta`
  (author avatar, role, `publishedLabel`, `readingMinutes` min read) → cover `MediaFrame` → `ArticleBody`
  (constrained `max-w-[70ch]` prose) → `ShareRow` → `RelatedPosts` → end **CTA** reusing the landing
  "Start free trial" button pattern (`bg-linear-to-r from-primary to-accent`).
- **Components:** `PostMeta`, `MediaFrame`, `ArticleBody`, `ShareRow`, `RelatedPosts`.
- **`ArticleBody`** renders the typed `body[]` blocks → `heading`→`<h2>`, `paragraph`→`<p>`, `list`→`<ul>/<ol>`,
  `quote`→`<blockquote>`, `image`→`<MediaFrame>`. Styled by a new `.article-prose` block in `globals.css`
  (§16) using semantic tokens only.
- **Animation:** section-level `data-reveal` on cover, body, related; `Underline` on the title's key phrase.
- **Copy:** per-post (§20); CTA `Ready to make your next audit the boring one?` → `Start free trial` → `/login`.

### 14.3 News index & detail — `src/app/news/page.tsx`, `src/app/news/[slug]/page.tsx`

- **Behavior:** News is the **lighter** variant — a reverse-chronological feed grouped by month; no featured
  hero, no category grid (tag chips instead). Detail is a compact article (title + `dateLabel` + tag +
  `ArticleBody`), same Server-Component + metadata treatment.
- **Layout (index):** `<LandingLayout>` → header (`Eyebrow` "News") → `NewsList`: month group headings
  (`h3`) with rows (date · tag chip · title · summary → link to detail).
- **Components:** new `NewsList`; reuse `Eyebrow`, `SectionHeading`, `PostMeta` (date/tag), `ArticleBody`.
- **Animation:** rows `data-reveal` stagger; tag-chip hover.
- **Copy:** header `Product updates, releases, and company news.` (see §20).

### 14.4 Navigation & Footer wiring

- **`Navigation.tsx`** — add to the `navLinks` array (lines 34-39). Note existing links are in-page anchors
  (`#features`); Blog/News are **route** links, so use `next/link` `href="/blog"` / `"/news"` (the array
  already renders through `<Link>`, so route hrefs work in both desktop and mobile menus):
  ```tsx
  { href: "/blog", label: "Blog" },
  { href: "/news", label: "News" },
  ```
  _(Optional: mark active route with `usePathname()` — already imported in the file.)_
- **`Footer.tsx`** — the "Company" column (line 82) currently maps plain strings to dead `#` links. Point
  "Blog" at `/blog` and add "News" — the simplest change is to convert that column to `{label, href}`
  objects (like the future data-driven footer) or special-case Blog/News to real `<Link href>`.

---

## 15. Components to build / reuse

**Reuse (`src/components/landing/_shared/`):** `Eyebrow`, `SectionHeading` (`as` polymorphic), `Underline`
(SVG draw), `MediaFrame` (the `next/image` wrapper with `aspect`/`preload`), and the `ScrollReveal` /
`data-reveal` entrance system (mounted once by `LandingLayout`).

**New (`src/components/blog/`):**

| Component        | Server/Client | Purpose                                                                              |
| ---------------- | ------------- | ------------------------------------------------------------------------------------ |
| `PostCard`       | server        | Cover (`MediaFrame`) + category chip + title + excerpt + `PostMeta`; links to detail. |
| `PostMeta`       | server        | Author avatar/name/role · `publishedLabel` · `readingMinutes` (or date · tag for News). |
| `ArticleBody`    | server        | Renders the `ArticleBlock[]` union into semantic prose (`.article-prose`).           |
| `CategoryFilter` | **client**    | Category chips; updates `?category=`; active-state styling. Wrap in `<Suspense>`.    |
| `ShareRow`       | **client**    | Web Share API + copy-link + X/LinkedIn intents.                                       |
| `RelatedPosts`   | server        | 3 `PostCard`s from `getRelatedPosts`.                                                 |
| `NewsList`       | server        | Month-grouped news rows.                                                              |

**Assets:** cover images in `public/blog/` and `public/news/` (add a `CREDITS.md` in each, mirroring
`public/marketing/CREDITS.md`). Avatars reuse `public/marketing/avatar-*.jpg` or add `public/blog/authors/`.

---

## 16. Styling & tokens

- **Semantic utilities only** — `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`,
  `bg-primary`, gradient `bg-linear-to-r from-primary to-accent`. **No raw palette classes, no `dark:` color
  variants** (per the `globals.css` header convention). Class-based dark mode (`.dark`) already flips tokens.
- **Tenant branding** — `--primary` is overridden at runtime by `TenantBrandingProvider`; any
  `bg-primary`/`text-primary` in blog/news inherits the tenant brand color automatically.
- **Article typography** — add a scoped `.article-prose` block to `src/app/globals.css` (headings, paragraph
  rhythm, lists, `blockquote`, links, inline `code`, figure/caption), all in terms of the existing tokens
  (`text-foreground`, `text-muted-foreground`, `border-border`, `text-primary`). This avoids adding a
  Tailwind typography plugin (keeps the CSS-first, no-config setup intact).

---

## 17. SEO / metadata

The reason the page files are Server Components. Per page:

- **`generateMetadata`** — `title`, `description` (from `excerpt`/`summary`), `alternates.canonical`,
  `openGraph` (title/description/type=`article`/`publishedTime`/`images` = cover), `twitter` card.
- **`generateStaticParams`** — from `getAllPostSlugs()` / `getAllNewsSlugs()` so detail pages prerender.
- **`src/app/sitemap.ts`** — enumerate `/`, `/blog`, `/news`, every `/blog/[slug]`, `/news/[slug]`
  (Next 16 `MetadataRoute.Sitemap`; **read `node_modules/next/dist/docs/` for the current sitemap API**).
- **JSON-LD** — inject an `Article`/`BlogPosting` `<script type="application/ld+json">` on detail pages
  (author, datePublished, headline, image, publisher).
- **`robots`** — allow crawling of `/blog` & `/news` (the app is otherwise auth-gated).
- Note: tenant document-title patching (`TenantBrandingProvider` sets `document.title`) runs client-side and
  won't clobber crawler-visible metadata; keep the static `<title>` authoritative for public SEO.

---

## 18. Motion

- **Near-term:** reuse the existing `data-reveal` entrance animations (add the attribute to sections/cards)
  + the `Underline` SVG draw + `MediaFrame` hover-zoom. **No new animation libraries** are needed for
  blog/news.
- **`prefers-reduced-motion`** is already respected by the `data-reveal` system — preserve it (static, no
  transform for reduced-motion users).
- **Forward-compatible:** once the immersive layer from **Part I** ships (GSAP/Lenis), blog index cards and
  article reveals can opt into ScrollTrigger stagger and Lenis smooth-scroll with no data changes — but that
  is out of scope here.

---

## 19. Assets

- **Cover images:** local `public/blog/` & `public/news/` (JPG/WebP). Free/CC sources: **Unsplash**
  (https://unsplash.com), **Pexels** (https://www.pexels.com), or reuse `public/marketing/*`. Credit each in
  a per-folder `CREDITS.md` (mirror `public/marketing/CREDITS.md`).
- **Why local:** `next.config.ts` `images.remotePatterns` only whitelists `http://localhost:5000/uploads/**`,
  so remote marketing images would need a config change (which requires reading `node_modules/next/dist/docs/`
  first). Local `public/` images avoid that entirely.
- **Author avatars:** reuse `public/marketing/avatar-*.jpg` or add `public/blog/authors/`.
- **Icons:** `lucide-react` (already a dependency) for category/tag/share icons.

---

## 20. Copy deck (sample content — anti-hype editorial voice)

> Placeholders (authors, dates) are illustrative — flag in each `CREDITS.md` / a header comment like
> `landing.ts` does. Dates are precomputed strings.

**Blog index header:** eyebrow `Blog` · heading **Field notes on calibration, compliance, and staying
audit-ready.** · sub _Practical writing for the biomedical and quality teams who keep hospital instruments
honest._

**Categories:** `Compliance · Calibration · Product · Company`

**Sample posts (title → excerpt):**

1. **What ISO 17025 actually asks of a hospital** _(Compliance)_ — _Strip away the jargon and the standard is
   four promises about traceability, competence, and records. Here's each one in plain language._
2. **Cutting audit prep from days to minutes** _(Compliance)_ — _Audit week doesn't have to mean a scramble
   through binders. How a single source of truth turns preparation into an export._
3. **Building a calibration schedule that runs itself** _(Calibration)_ — _Set an interval per device class
   once, and let work orders, reminders, and drift warnings do the chasing._
4. **Traceability, explained with one blood-gas analyser** _(Calibration)_ — _Follow a single reading back to
   a national standard — and see why the chain matters when an assessor asks._
5. **Multi-tenant by design: one console, every facility** _(Product)_ — _Why we isolate each hospital's data
   at the core, and what that means for group operators running many sites._
6. **Signed certificates your assessors accept** _(Product)_ — _From bench reading to a QR-verifiable PDF —
   the anatomy of a certificate that holds up._

**Blog CTA (article end):** heading `Make your next audit the boring one.` · button `Start free trial` →
`/login` · secondary `See how it works` → `/#how-it-works`.

**News index header:** eyebrow `News` · heading **Product updates, releases, and company news.**

**Sample news items (dateLabel · tag · title → summary):**

- _July 2, 2026 · Release_ — **Client-side certificate PDFs** — _Certificates now render instantly in the
  browser from the signed record, with a verification QR baked in._
- _June 20, 2026 · Product_ — **Real-time notifications, per tenant** — _Every tenant now sees only its own
  alerts — with super-admin oversight across all tenants — plus an audible cue for new activity._
- _June 5, 2026 · Compliance_ — **KARS & SNARS mapping** — _Accreditation checklists now map directly to the
  records that satisfy them._
- _May 22, 2026 · Company_ — **HDC is now available across Indonesia** — _Bringing traceable calibration to
  more hospital networks._

---

## 21. Backend CMS migration path (static → `content-cms`)

The static data files are designed so the future CMS ([`MODULES.md`](../BACKEND/10-MODULE-REFERENCE.md) §7.3.M / §6.2 `content-cms`)
is a drop-in swap, not a rewrite:

- **One seam:** only the **access helpers** (`getPostBySlug`, `getPostsByCategory`, `getAllPostSlugs`, …)
  touch data. The CMS phase reimplements _these functions_ as calls to a public content API
  (`GET /api/v1/blog`, `/api/v1/blog/:slug`) — pages/components are untouched.
- **Portable body:** the `ArticleBlock[]` union maps 1:1 to a CMS rich-text/blocks field, so authored content
  round-trips.
- **Stable slugs:** slugs are the primary key in both worlds → URLs and any inbound links survive.
- **Backend shape (when built):** follow the **Vendor** module (`model → service → controller → route`) with
  `tenantId` (platform-global posts can use a null/shared tenant), soft-delete via the `isDeleted` attribute
  (Warehouse/Attachment pattern — **not** `this.is_deleted`), a `dynamicAccess("Content", action)` menu group
  + `ROLE_MENU_ASSIGNMENTS` grant, and `Attachment` reuse for media. Add a dashboard authoring UI
  (draft → review → publish).
- **SEO continuity:** `generateStaticParams` switches from the array to the API list; ISR/revalidation
  replaces full static (read `node_modules/next/dist/docs/` for the Next 16 revalidation API).

---

## 22. Blog & News — phased roadmap & verification

**Roadmap**

1. **Blog (static)** — `src/data/blog.ts` + `/blog` + `/blog/[slug]` + `PostCard`/`PostMeta`/`ArticleBody`/
   `CategoryFilter`/`ShareRow`/`RelatedPosts` + `.article-prose` in `globals.css` + nav/footer links.
2. **News (static)** — `src/data/news.ts` + `/news` + `/news/[slug]` + `NewsList` (reusing blog components).
3. **SEO** — `generateMetadata`/`generateStaticParams` on all four pages + `sitemap.ts` + JSON-LD + robots.
4. **CMS migration** — the `content-cms` backend + authoring UI; swap the data-access helpers to the API.

**Verification (for the eventual build pass)**

- `npm run build` (bun-compile / `next-bun-compile`) succeeds; `cacheComponents` prerender clean (no
  `new Date()`-in-render violations).
- `/blog`, `/blog/[slug]`, `/news`, `/news/[slug]` render; unknown slug → `notFound()` (404).
- **Metadata present:** view-source shows per-page `<title>`, meta description, OpenGraph, and JSON-LD;
  `/sitemap.xml` lists all posts.
- **Reduced-motion** renders static (no reveal transforms); **light + dark** both correct; **tenant brand
  color** flows through `--primary` on cards/CTAs (test 2–3 tenant primaries).
- Nav & footer links resolve to `/blog` and `/news`; the old dead footer "Blog" link is gone.
- Lighthouse: SEO ≥ 95, Perf ≥ 90 on the blog index.

---

_Part II is grounded in the same codebase as Part I: landing pattern `src/app/page.tsx` +
`src/components/landing/_shared/*` + `src/data/landing.ts`; shell `src/components/layouts/LandingLayout.tsx`,
`Navigation.tsx` (navLinks 34-39), `Footer.tsx` (Company column, line 82); tokens & reveal system in
`src/app/globals.css`; branding via `src/components/TenantBrandingProvider.tsx`. It honors the modified
Next 16 constraints (`cacheComponents`, `next-bun-compile`, no `new Date()` in render, `<Suspense>` for
search params, and reading `node_modules/next/dist/docs/` before any config/font/image change). The eventual
CMS is catalogued in `MODULES.md` §7.3.M and §6.2 (`content-cms`)._

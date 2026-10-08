// src/app/page.tsx
//
// P10-03 (ADR-098, docs/UI-UX/20-LANDING-AUTH-REVAMP.md §6): the landing page,
// a SERVER component. P10-17 (ADR-118) rebuilt its composition around people:
// an ivory/charcoal/copper palette with one deep-charcoal inverted section,
// licensed editorial photographs captioned as illustrations, and a page rhythm
// of dense → airy → immersive → editorial → interactive → minimal.
//
// Interaction lives in small client islands with no animation library: the
// greeting, the hero's pointer layer (the gauge needle follows the cursor), the
// before/after comparison, the workflow story, the certificate explorer and the
// QR verification demo. Everything else is CSS (landing.css). No text is
// server-rendered hidden: the hero <h1> is in the HTML the server sends and
// never fades from 0.
//
// Every string comes from the dictionaries (src/i18n/messages). Every claim
// carries its source in doc 20 §11, and src/tests/public/copyTruthfulness.p1011.test.ts
// fails the build on a banned term or an unsourced number.
import type { Metadata } from "next";
import { Suspense } from "react";
import type React from "react";
import Image from "next/image";
import Link from "next/link";
import "../../components/public/landing/landing.css";
import { ArrowRight, Mail, MessageCircle, Plus, QrCode, ShieldCheck } from "@/components/icons/static";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey, Translate } from "@/i18n";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PrecisionScale } from "@/components/public/PrecisionScale";
import { contactChannels } from "@/components/public/contact";
import { WorkflowStory, type WorkflowStep, type WorkflowStepId } from "@/components/public/landing/WorkflowStory";
import { HeroPointer } from "@/components/public/landing/HeroPointer";
import { TimeGreeting } from "@/components/public/landing/TimeGreeting";
import { QrVerifyDemo } from "@/components/public/landing/QrVerifyDemo";
import { DemoQr } from "@/components/public/landing/DemoQr";
import { BeforeAfter } from "@/components/public/landing/BeforeAfter";
import { CertificateExplorer, type CertificateField } from "@/components/public/landing/CertificateExplorer";
import { CUSTOMER_STORIES } from "@/components/public/landing/customerStories";
import { LANDING_PHOTOS } from "@/components/public/landing/photos";
import { CERTIFICATE_LOOKUP_ENABLED } from "@/lib/publicFeatures";
import { PRODUCT_SHOTS } from "@/components/public/landing/productShots";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t("landing.meta.title"),
    description: t("landing.meta.description"),
  };
}

/** A CSS custom property on an element's style (the stagger index). */
const cssVars = (vars: Record<string, number>) => vars as React.CSSProperties;

function ContactButtons({ t }: { t: Translate }) {
  const channels = contactChannels({
    whatsappText: t("landing.contact.whatsappText"),
    emailSubject: t("landing.contact.emailSubject"),
  });
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {channels.whatsappUrl ? (
        <a href={channels.whatsappUrl} className="pub-btn pub-btn-primary" rel="noopener noreferrer" target="_blank">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t("landing.hero.ctaWhatsapp")}
        </a>
      ) : null}
      {channels.emailUrl ? (
        <a
          href={channels.emailUrl}
          className={`pub-btn ${channels.whatsappUrl ? "pub-btn-secondary" : "pub-btn-primary"}`}
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          {t("landing.hero.ctaEmail")}
        </a>
      ) : null}
      {/* Always present, so the page never ends with no way forward (doc 20 §6.1). */}
      <Link
        href="/request-access"
        className={
          channels.whatsappUrl || channels.emailUrl
            ? "pub-link inline-flex items-center gap-1.5 py-2 text-[0.9375rem] font-medium"
            : "pub-btn pub-btn-primary"
        }
      >
        {t("landing.hero.ctaRequest")}
        <ArrowRight className="pub-arrow h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

const FLOW: ReadonlyArray<{ id: WorkflowStepId; title: MessageKey; text: MessageKey; fx: MessageKey }> = [
  { id: "device", title: "landing.flow.deviceTitle", text: "landing.flow.device", fx: "landing.flow.fx.device" },
  { id: "schedule", title: "landing.flow.scheduleTitle", text: "landing.flow.schedule", fx: "landing.flow.fx.schedule" },
  { id: "calibrate", title: "landing.flow.calibrateTitle", text: "landing.flow.calibrate", fx: "landing.flow.fx.calibrate" },
  {
    id: "certificate",
    title: "landing.flow.certificateTitle",
    text: "landing.flow.certificate",
    fx: "landing.flow.fx.certificate",
  },
  { id: "sign", title: "landing.flow.signTitle", text: "landing.flow.sign", fx: "landing.flow.fx.sign" },
  { id: "verify", title: "landing.flow.verifyTitle", text: "landing.flow.verify", fx: "landing.flow.fx.verify" },
];

const MOMENTS: ReadonlyArray<{ when: MessageKey; moment: MessageKey; after: MessageKey }> = [
  { when: "landing.moments.1.when", moment: "landing.problem.1", after: "landing.moments.1.after" },
  { when: "landing.moments.2.when", moment: "landing.problem.2", after: "landing.moments.2.after" },
  { when: "landing.moments.3.when", moment: "landing.problem.3", after: "landing.moments.3.after" },
];

/** "Juga tersedia" as a typographic index — no cards, no icons. */
const CAPS: readonly MessageKey[] = [
  "landing.caps.multisite",
  "landing.caps.audit",
  "landing.caps.stock",
  "landing.caps.maintenance",
  "landing.caps.reports",
  "landing.caps.qms",
  "landing.caps.api",
  "landing.caps.roles",
  "landing.caps.language",
];

const SECURITY: readonly MessageKey[] = [
  "landing.security.isolation",
  "landing.security.mfa",
  "landing.security.sso",
  "landing.security.passkey",
  "landing.security.throttle",
  // "landing.security.auditRows" ships only once the audit-log REVOKE and
  // migration 0091's trigger are confirmed on the reference deployment as the
  // application role (doc 20 §11.1, P10-03 DoD). Not yet confirmed: withheld.
];

const WORK: ReadonlyArray<[MessageKey, MessageKey]> = [
  ["landing.work.step1", "landing.work.step1Text"],
  ["landing.work.step2", "landing.work.step2Text"],
  ["landing.work.step3", "landing.work.step3Text"],
];

const PROOF: ReadonlyArray<{ href: string; key: MessageKey }> = [
  { href: "#verifikasi", key: "landing.proof.verify" },
  { href: "#keamanan", key: "landing.proof.security" },
  { href: "#cara-kerja", key: "landing.proof.work" },
];

const FAQ: ReadonlyArray<[MessageKey, MessageKey]> = [
  ["landing.faq.q1", "landing.faq.a1"],
  ["landing.faq.q2", "landing.faq.a2"],
  ["landing.faq.q3", "landing.faq.a3"],
  ["landing.faq.q4", "landing.faq.a4"],
  ["landing.faq.q5", "landing.faq.a5"],
  ["landing.faq.q6", "landing.faq.a6"],
];

/** The demo certificate (sample data, ADR-118): a fixed, invented record. */
const DEMO_CERTIFICATE_NUMBER = "CERT-20261005-CONTOH-0001";
const DEMO_VALID_UNTIL = new Date(Date.UTC(2027, 9, 5));

// ── Skeleton shown while the locale cookie resolves ────────────────────────
// Matches the above-the-fold layout so there is no layout shift once
// HomeContent streams in. cacheComponents caches HomeContent's sub-tree
// per locale, so subsequent requests for the same locale skip the work.
function HomeLoading() {
  return (
    <div className="flex min-h-dvh flex-col" aria-hidden="true">
      {/* Header placeholder */}
      <div className="h-16" />
      {/* Hero placeholder */}
      <div className="grid lg:min-h-[min(88vh,860px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-5 px-4 py-14 sm:px-6 lg:py-20 lg:pl-[max(1rem,calc((100vw-1200px)/2+2rem))] lg:pr-14">
          <div className="h-7 w-56 motion-safe:animate-pulse rounded-full bg-pub-border" />
          <div className="h-8 w-2/3 motion-safe:animate-pulse rounded bg-pub-border" />
          <div className="h-14 w-full motion-safe:animate-pulse rounded bg-pub-border" />
          <div className="h-14 w-4/5 motion-safe:animate-pulse rounded bg-pub-border" />
          <div className="h-5 w-full motion-safe:animate-pulse rounded bg-pub-border" />
          <div className="h-5 w-5/6 motion-safe:animate-pulse rounded bg-pub-border" />
          <div className="h-11 w-48 motion-safe:animate-pulse rounded-md bg-pub-border" />
        </div>
        <div className="min-h-[26rem] motion-safe:animate-pulse bg-pub-border" />
      </div>
    </div>
  );
}

// ── Locale-aware content (streams in, cached per locale by cacheComponents) ──
async function HomeContent() {
  const { locale, t } = await getServerI18n();
  const year = new Date().getFullYear();
  const shots = PRODUCT_SHOTS;
  const photos = LANDING_PHOTOS;

  const steps: WorkflowStep[] = FLOW.map((s, i) => ({
    id: s.id,
    number: String(i + 1).padStart(2, "0"),
    title: t(s.title),
    text: t(s.text),
    fx: t(s.fx),
    progress: t("landing.flow.progress", { n: i + 1, total: FLOW.length }),
    image: { ...shots[s.id], alt: t(shots[s.id].altKey) },
  }));

  const validUntil = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(DEMO_VALID_UNTIL);

  // The explorable certificate: every value is invented and labelled sample data.
  const certFields: CertificateField[] = [
    { label: t("landing.cert.facility"), value: t("landing.cert.facilityValue") },
    { label: t("landing.cert.location"), value: t("landing.cert.locationValue"), spot: 0 },
    { label: t("landing.cert.device"), value: t("landing.demo.deviceValue"), spot: 0 },
    { label: t("landing.cert.standard"), value: t("landing.cert.standardValue"), spot: 1 },
    { label: t("landing.cert.technician"), value: t("landing.cert.technicianValue") },
    { label: t("landing.cert.result"), value: t("landing.cert.resultValue") },
    { label: t("landing.cert.signer"), value: t("landing.cert.signerValue"), spot: 2 },
    { label: t("landing.demo.validUntil"), value: validUntil },
  ];
  const certSpots = ([1, 2, 3, 4] as const).map((n) => ({
    title: t(`landing.cert.hs.${n}.title`),
    text: t(`landing.cert.hs.${n}.text`),
  }));
  const demoQr = <DemoQr label={t("landing.demo.qrLabel")} />;

  return (
    <>
      <a href="#konten" className="pub-skip">
        {t("pub.skip")}
      </a>
      <PublicHeader locale={locale} t={t} />

      <main id="konten" tabIndex={-1} className="flex-1 outline-none">
        {/* ── 1. Hero — dense: relief first, then proof; a full-bleed photograph ─ */}
        <section aria-labelledby="hero-title" className="lp-section">
          <HeroPointer className="lp-hero">
            <div className="lp-hero-text flex flex-col justify-center px-4 pb-14 pt-10 sm:px-6 lg:py-20">
              <p className="lp-enter lp-chip lp-greeting-chip self-start" style={cssVars({ "--lp-i": 0 })}>
                <span className="mt-[0.45em] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-pub-gold sm:mt-0" aria-hidden="true" />
                <span className="lp-greeting-text">
                  <TimeGreeting
                    words={{
                      default: t("landing.hero.greeting.default"),
                      morning: t("landing.hero.greeting.morning"),
                      midday: t("landing.hero.greeting.midday"),
                      afternoon: t("landing.hero.greeting.afternoon"),
                      evening: t("landing.hero.greeting.evening"),
                    }}
                  />
                  , {t("landing.hero.greetingTail")}
                </span>
              </p>
              <p className="lp-enter lp-kicker mt-8" style={cssVars({ "--lp-i": 1 })}>
                {t("landing.hero.kicker")} <em className="lp-em">{t("landing.hero.kickerEm")}</em>
              </p>
              <h1 id="hero-title" className="lp-enter-title lp-mega mt-4 max-w-[13ch] text-pub-text">
                {t("landing.hero.title")}
              </h1>
              <p className="lp-enter pub-body-l mt-7 max-w-[34rem] text-pub-muted" style={cssVars({ "--lp-i": 3 })}>
                {t("landing.hero.lead")}
              </p>
              <div className="lp-enter mt-9" style={cssVars({ "--lp-i": 4 })}>
                <ContactButtons t={t} />
              </div>
              <div
                className="lp-enter mt-10 flex flex-col gap-3 text-[0.9375rem] sm:flex-row sm:items-center sm:justify-between"
                style={cssVars({ "--lp-i": 5 })}
              >
                <p className="flex flex-1 items-center gap-2 text-pub-muted">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-pub-accent" aria-hidden="true" />
                  {t("landing.hero.eyebrow")}
                </p>
                <Link href="/login" className="pub-link-quiet inline-flex min-h-11 items-center gap-1.5">
                  {t("landing.hero.signin")}
                  <ArrowRight className="pub-arrow h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <figure className="lp-hero-media order-first lg:order-none">
              <div className="lp-photo">
                <Image
                  src={photos.clinician.src}
                  width={photos.clinician.width}
                  height={photos.clinician.height}
                  alt={t(photos.clinician.altKey)}
                  preload
                  loading="eager"
                  fetchPriority="high"
                  sizes="(min-width: 1024px) 48vw, 100vw"
                  className="h-full w-full object-cover object-[62%_50%]"
                />
              </div>
              {/* The one interactive element: the needle follows a fine pointer. */}
              <div className="lp-gauge-card lp-enter-visual" style={cssVars({ "--lp-i": 4 })}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.75rem] font-semibold text-pub-text">{t("landing.hero.gaugeTitle")}</span>
                  <span className="lp-sample-tag">{t("landing.hero.sampleCaption")}</span>
                </div>
                <PrecisionScale follow className="mt-1 w-full" />
                <p className="lp-gauge-hint -mt-1 text-[0.75rem] leading-snug text-pub-subtle">{t("landing.hero.gaugeHint")}</p>
              </div>
              <figcaption className="lp-caption absolute bottom-2 right-3 rounded bg-pub-raised/85 px-2 py-0.5">
                {t("landing.photo.caption")}
              </figcaption>
            </figure>
          </HeroPointer>
        </section>

        {/* ── 2. Story — airy: the problem as moments, in type ─────────────── */}
        <section aria-labelledby="problem-title" className="lp-section">
          <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-24 sm:px-6 lg:px-8 lg:pb-20 lg:pt-36">
            <p className="lp-eyebrow">{t("landing.story.eyebrow")}</p>
            <h2 id="problem-title" className="lp-reveal pub-display pub-display-l mt-5 max-w-3xl text-pub-text">
              {t("landing.problem.title")}
            </h2>
            <p className="lp-reveal pub-body-l mt-5 max-w-2xl text-pub-muted">{t("landing.moments.lead")}</p>
            <ol className="mt-14 border-b border-pub-border">
              {MOMENTS.map((m, i) => (
                <li key={m.moment} className="lp-reveal lp-moment-row">
                  <span className="lp-moment-num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-pub-subtle md:pt-3">{t(m.when)}</p>
                  <p className="lp-moment-text col-span-2 md:col-span-1">{t(m.moment)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 3. The human moment — immersive, full bleed ──────────────────── */}
        <figure className="lp-bleed" aria-labelledby="human-moment">
          <Image
            src={photos.latePaperwork.src}
            width={photos.latePaperwork.width}
            height={photos.latePaperwork.height}
            alt=""
            sizes="100vw"
            className="lp-parallax"
          />
          <div className="lp-bleed-veil">
            <p id="human-moment" className="lp-bleed-quote">
              {t("landing.story.human")}
            </p>
            <p className="lp-bleed-caption mt-3 text-[0.8125rem]">{t("landing.photo.caption")}</p>
          </div>
        </figure>

        {/* ── 4. Transformation — before/after, and what changes ───────────── */}
        <section aria-labelledby="transform-title" className="lp-section bg-pub-surface">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-16 lg:px-8 lg:py-32">
            <BeforeAfter
              sliderLabel={t("landing.story.slider")}
              valueText={t("landing.story.sliderValue")}
              before={{ ...photos.paperwork, alt: t("landing.story.before"), label: t("landing.story.before") }}
              after={{ ...shots.schedule, alt: t("landing.story.afterAlt"), label: t("landing.story.after") }}
            />
            <div>
              <p className="lp-eyebrow">{t("landing.story.transformEyebrow")}</p>
              <h2 id="transform-title" className="pub-display pub-display-l mt-5 text-pub-text">
                {t("landing.story.transformTitle")}
              </h2>
              <ul className="mt-8 space-y-6">
                {MOMENTS.map((m) => (
                  <li key={m.after} className="lp-reveal border-l-2 border-pub-gold pl-5 text-pub-muted">
                    {t(m.after)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── 5. Product experience — the six-step story (interactive) ─────── */}
        <section aria-labelledby="alur-kerja-title" id="alur-kerja" className="lp-section scroll-mt-20">
          <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
            <div className="lp-reveal grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16">
              <div>
                <p className="lp-eyebrow">{t("landing.flow.eyebrow")}</p>
                <h2 id="alur-kerja-title" className="pub-display pub-display-l mt-5 text-pub-text">
                  {t("landing.flow.title")}
                </h2>
              </div>
              <p className="pub-body-l text-pub-muted">{t("landing.flow.lead")}</p>
            </div>
            <div className="mt-14">
              <WorkflowStory steps={steps} caption={t("landing.hero.sampleCaption")} label={t("landing.flow.title")} />
            </div>
          </div>
        </section>

        {/* ── 6. Personalization — the explorable certificate (editorial) ──── */}
        <section aria-labelledby="cert-title" className="lp-section border-t border-pub-border">
          <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
            <div className="max-w-2xl">
              <p className="lp-eyebrow">{t("landing.cert.eyebrow")}</p>
              <h2 id="cert-title" className="lp-reveal pub-display pub-display-l mt-5 text-pub-text">
                {t("landing.cert.title")}
              </h2>
              <p className="pub-body-l mt-5 text-pub-muted">{t("landing.cert.lead")}</p>
            </div>
            <div className="mt-14">
              <CertificateExplorer
                docTitle={t("landing.cert.docTitle")}
                number={DEMO_CERTIFICATE_NUMBER}
                fields={certFields}
                spots={certSpots}
                qr={demoQr}
                verified={t("verify.valid")}
                sample={t("landing.cert.sample")}
                spotLabel={t("landing.cert.spot")}
                slideLabels={certSpots.map((_, i) => t("landing.cert.slide", { n: i + 1, total: certSpots.length }))}
                carouselLabel={t("landing.cert.carousel")}
              />
            </div>
          </div>
        </section>

        {/* ── 7. Public verification — the inverted section, the "wow" ─────── */}
        <section aria-labelledby="verifikasi-title" id="verifikasi" className="lp-section lp-inverted scroll-mt-20">
          <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-end lg:gap-16">
              <div>
                <p className="lp-eyebrow">{t("landing.verify.eyebrow")}</p>
                <h2 id="verifikasi-title" className="lp-mega mt-5 text-pub-text">
                  {t("landing.verify.title")}
                </h2>
              </div>
              <div>
                <p className="pub-body-l text-pub-muted">{t("landing.verify.lead")}</p>
                {CERTIFICATE_LOOKUP_ENABLED ? (
                  // A plain GET form: /verify?number=… redirects to /verify/<number>. Works without JS.
                  <form method="get" action="/verify" className="lp-paper mt-6 max-w-md rounded-xl p-4">
                    <label htmlFor="landing-cert-number" className="pub-label">
                      {t("landing.verify.label")}
                    </label>
                    <div className="flex gap-3">
                      <input
                        id="landing-cert-number"
                        name="number"
                        type="text"
                        required
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby="landing-cert-help"
                        className="pub-input tabular-nums"
                      />
                      <button type="submit" className="pub-btn pub-btn-primary shrink-0">
                        {t("landing.verify.button")}
                      </button>
                    </div>
                    <p id="landing-cert-help" className="pub-help">
                      {t("landing.verify.help")}
                    </p>
                  </form>
                ) : (
                  <p className="mt-5 flex items-start gap-3 text-pub-muted">
                    <QrCode className="mt-1 h-5 w-5 shrink-0 text-pub-accent" aria-hidden="true" />
                    <span>{t("landing.flow.verify")}</span>
                  </p>
                )}
              </div>
            </div>
            <p className="mt-16 text-pub-muted">{t("landing.demo.hint")}</p>
            <div className="mt-8">
              <QrVerifyDemo
                certificateTitle={t("landing.cert.docTitle")}
                certificate={{ number: DEMO_CERTIFICATE_NUMBER, device: t("landing.demo.deviceValue"), validUntil }}
                qr={demoQr}
                labels={{
                  scan: t("landing.demo.scan"),
                  scanning: t("landing.demo.scanning"),
                  again: t("landing.demo.again"),
                  idle: t("landing.demo.idle"),
                  sample: t("landing.demo.sample"),
                  phoneLabel: t("landing.demo.phoneLabel"),
                  verdict: t("verify.valid"),
                  verdictLead: t("verify.validLead"),
                  certNumber: t("landing.demo.certNumber"),
                  device: t("landing.demo.device"),
                  validUntil: t("landing.demo.validUntil"),
                }}
              />
            </div>
          </div>
        </section>

        {/* ── 8. Proof — honest and MINIMAL: one centred statement, three links
               in a row. Real customer stories, once they exist and are
               permitted, render from CUSTOMER_STORIES (empty today). ─────── */}
        <section aria-labelledby="proof-title" className="lp-section">
          <div className="mx-auto max-w-[920px] px-4 py-24 text-center sm:px-6 lg:py-32">
            <h2 id="proof-title" className="lp-mega mx-auto max-w-[18ch] text-pub-text">
              {t("landing.proof.title")}
            </h2>
            <p className="pub-body-l mx-auto mt-6 max-w-2xl text-pub-muted">{t("landing.proof.lead")}</p>
            {CUSTOMER_STORIES.length > 0 ? (
              <ul className="mx-auto mt-12 max-w-3xl space-y-8 text-left">
                {CUSTOMER_STORIES.map((story) => (
                  <li key={story.id}>
                    <blockquote className="pub-display text-[1.75rem] leading-tight text-pub-text">{story.quote[locale]}</blockquote>
                    <p className="mt-3 text-pub-muted">
                      {story.name} · {story.role[locale]} · {story.facility}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="mt-12 flex flex-col items-stretch gap-3 text-left md:flex-row md:justify-center">
              {PROOF.map((p) => (
                <li key={p.href} className="md:max-w-[17rem] md:flex-1">
                  <a href={p.href} className="lp-proof-chip">
                    <span>{t(p.key)}</span>
                    <ArrowRight className="pub-arrow h-4 w-4 shrink-0 text-pub-accent" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 9. Compliance and security — editorial: the disclaimer as a large
               serif statement over a full-height photograph, the standards and
               controls as two quiet columns underneath. ───────────────────── */}
        <section aria-labelledby="keamanan-title" id="keamanan" className="lp-section scroll-mt-20 bg-pub-surface">
          <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <figure className="lp-photo min-h-[18rem] lg:min-h-full">
              <Image
                src={photos.inspection.src}
                width={photos.inspection.width}
                height={photos.inspection.height}
                alt={t(photos.inspection.altKey)}
                sizes="(min-width: 1024px) 42vw, 100vw"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <figcaption className="lp-caption absolute bottom-2 left-3 rounded bg-pub-raised/85 px-2 py-0.5">
                {t("landing.photo.caption")}
              </figcaption>
            </figure>
            <div className="px-4 py-20 sm:px-6 lg:py-28 lg:pl-16 lg:pr-[var(--lp-gutter)]">
              <h2 id="keamanan-title" className="lp-eyebrow">
                {t("landing.compliance.title")}
              </h2>
              <p className="lp-statement mt-6">{t("landing.compliance.disclaimer")}</p>
              <div className="mt-14 grid gap-10 border-t border-pub-border pt-10 sm:grid-cols-2">
                <div className="lp-reveal">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-pub-subtle">
                    {t("landing.compliance.standardsTitle")}
                  </h3>
                  <ul className="mt-5 space-y-4 text-pub-muted">
                    {(
                      ["landing.compliance.iso17025", "landing.compliance.part11", "landing.compliance.accreditation"] as const
                    ).map((k) => (
                      <li key={k}>{t(k)}</li>
                    ))}
                  </ul>
                </div>
                <div className="lp-reveal">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-pub-subtle">{t("landing.security.title")}</h3>
                  <ul className="mt-5 space-y-4 text-pub-muted">
                    {SECURITY.map((k) => (
                      <li key={k} className="flex gap-3">
                        <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-pub-accent" aria-hidden="true" />
                        <span>{t(k)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 10. Also available — run-in type, not a list of cards: the
               capabilities flow as one editorial paragraph. ───────────────── */}
        <section aria-labelledby="fitur-title" id="fitur" className="lp-section scroll-mt-20">
          <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
            <h2 id="fitur-title" className="lp-eyebrow">
              {t("landing.caps.title")}
            </h2>
            <ul className="lp-runin mt-8">
              {CAPS.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 11. How we work — a human photo moment, full width, with the
               three steps as a horizontal timeline beneath it. ───────────── */}
        <section aria-labelledby="work-title" id="cara-kerja" className="lp-section scroll-mt-20 bg-pub-surface">
          <figure className="lp-work-band">
            <Image
              src={photos.deviceCheck.src}
              width={photos.deviceCheck.width}
              height={photos.deviceCheck.height}
              alt={t(photos.deviceCheck.altKey)}
              sizes="100vw"
              className="lp-parallax"
            />
            <div className="lp-work-band-text">
              <h2 id="work-title" className="pub-display pub-display-l text-pub-inv-text">
                {t("landing.work.title")}
              </h2>
              <p className="pub-body-l mt-4 max-w-xl text-pub-inv-muted">{t("landing.work.lead")}</p>
            </div>
            <figcaption className="lp-caption absolute bottom-2 right-3 rounded bg-pub-raised/85 px-2 py-0.5">
              {t("landing.work.photoCaption")}
            </figcaption>
          </figure>
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:px-8">
            <ol className="lp-htimeline">
              {WORK.map(([title, text], i) => (
                <li key={title} className="lp-reveal">
                  <span className="lp-timeline-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-pub-text">{t(title)}</h3>
                  <p className="mt-2 text-pub-muted">{t(text)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 12. FAQ — native <details>, no script ────────────────────────── */}
        <section aria-labelledby="faq-title" id="faq" className="lp-section scroll-mt-20 border-t border-pub-border">
          <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:px-8">
            <h2 id="faq-title" className="pub-display pub-display-l text-pub-text">
              {t("landing.faq.title")}
            </h2>
            <div className="divide-y divide-pub-border border-y border-pub-border">
              {FAQ.map(([q, a]) => (
                <details key={q} className="pub-faq group">
                  <summary className="flex min-h-11 items-center justify-between gap-6 py-5 text-left text-[1.0625rem] font-medium text-pub-text">
                    <span>{t(q)}</span>
                    <Plus className="pub-faq-icon h-5 w-5 shrink-0 text-pub-accent" aria-hidden="true" />
                  </summary>
                  <p className="pb-6 pr-10 text-pub-muted">{t(a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── 13. Closing — minimal: the journey's emotional conclusion ────── */}
        <section aria-labelledby="kontak-title" id="kontak" className="lp-section scroll-mt-20">
          <div className="mx-auto max-w-[1200px] px-4 py-28 sm:px-6 lg:px-8 lg:py-40">
            <p className="lp-kicker">{t("landing.contact.kicker")}</p>
            <h2 id="kontak-title" className="lp-mega mt-4 max-w-[16ch] text-pub-text">
              {t("landing.contact.title")}
            </h2>
            <p className="pub-body-l pub-prose mt-7 text-pub-muted">{t("landing.contact.lead")}</p>
            <div className="mt-10">
              <ContactButtons t={t} />
            </div>
          </div>
        </section>
      </main>

      <PublicFooter locale={locale} t={t} year={year} />
    </>
  );
}

// ── Page shell — prerenderable, no cookie access ─────────────────────────────
export default function Home() {
  return (
    <PublicSurface>
      <Suspense fallback={<HomeLoading />}>
        <HomeContent />
      </Suspense>
    </PublicSurface>
  );
}

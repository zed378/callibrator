// src/app/page.tsx
//
// P10-03 (ADR-098, docs/UI-UX/20-LANDING-AUTH-REVAMP.md §6): the landing page,
// rebuilt as a SERVER component. Client JavaScript is limited to two islands:
// the header's menu button and the workflow story's observer. No animation
// library loads here (GSAP, ScrollTrigger, SplitText, Lenis and Motion are
// gone from `/`), and no text is server-rendered hidden: the hero <h1> is
// visible in the HTML the server sends.
//
// Every string comes from the dictionaries (src/i18n/messages). Every claim
// carries its source in doc 20 §11, and src/tests/copyTruthfulness.p1011.test.ts
// fails the build on a banned term or an unsourced number.
import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Mail, MessageCircle, Plus, QrCode } from "@/components/icons/static";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey, Translate } from "@/i18n";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PrecisionScale } from "@/components/public/PrecisionScale";
import { contactChannels } from "@/components/public/contact";
import { WorkflowStory, type WorkflowStep } from "@/components/public/landing/WorkflowStory";
import { CERTIFICATE_LOOKUP_ENABLED } from "@/lib/publicFeatures";
import { PRODUCT_SHOTS } from "@/components/public/landing/productShots";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t("landing.meta.title"),
    description: t("landing.meta.description"),
  };
}

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
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow?: string; title: string }) {
  return (
    <div className="max-w-3xl">
      {eyebrow ? (
        <p className="pub-eyebrow flex items-center gap-3">
          <span className="pub-rule-in inline-block h-px w-8 bg-pub-accent" aria-hidden="true" />
          {eyebrow}
        </p>
      ) : null}
      <h2 id={id} className="pub-display pub-display-l mt-4 text-pub-text">
        {title}
      </h2>
    </div>
  );
}

const FLOW: ReadonlyArray<{ id: keyof typeof PRODUCT_SHOTS; title: MessageKey; text: MessageKey }> = [
  { id: "device", title: "landing.flow.deviceTitle", text: "landing.flow.device" },
  { id: "schedule", title: "landing.flow.scheduleTitle", text: "landing.flow.schedule" },
  { id: "calibrate", title: "landing.flow.calibrateTitle", text: "landing.flow.calibrate" },
  { id: "certificate", title: "landing.flow.certificateTitle", text: "landing.flow.certificate" },
  { id: "sign", title: "landing.flow.signTitle", text: "landing.flow.sign" },
  { id: "verify", title: "landing.flow.verifyTitle", text: "landing.flow.verify" },
];

const CAPS: readonly MessageKey[] = [
  "landing.caps.stock",
  "landing.caps.maintenance",
  "landing.caps.multisite",
  "landing.caps.reports",
  "landing.caps.api",
  "landing.caps.qms",
  "landing.caps.audit",
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

const FAQ: ReadonlyArray<[MessageKey, MessageKey]> = [
  ["landing.faq.q1", "landing.faq.a1"],
  ["landing.faq.q2", "landing.faq.a2"],
  ["landing.faq.q3", "landing.faq.a3"],
  ["landing.faq.q4", "landing.faq.a4"],
  ["landing.faq.q5", "landing.faq.a5"],
  ["landing.faq.q6", "landing.faq.a6"],
];

// ── Skeleton shown while the locale cookie resolves ────────────────────────
// Matches the above-the-fold height so there is no layout shift once
// HomeContent streams in. cacheComponents caches HomeContent's sub-tree
// per locale, so subsequent requests for the same locale skip the work.
function HomeLoading() {
  return (
    <div className="flex min-h-dvh flex-col" aria-hidden="true">
      {/* Header placeholder */}
      <div className="h-16 border-b border-pub-border bg-pub-bg/80" />
      {/* Hero placeholder */}
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-14">
          <div className="space-y-5">
            <div className="h-4 w-24 animate-pulse rounded bg-pub-border" />
            <div className="h-10 w-3/4 animate-pulse rounded bg-pub-border" />
            <div className="h-10 w-1/2 animate-pulse rounded bg-pub-border" />
            <div className="h-5 w-full animate-pulse rounded bg-pub-border" />
            <div className="h-5 w-5/6 animate-pulse rounded bg-pub-border" />
            <div className="flex gap-3 pt-4">
              <div className="h-10 w-36 animate-pulse rounded-lg bg-pub-border" />
              <div className="h-10 w-32 animate-pulse rounded-lg bg-pub-border" />
            </div>
          </div>
          <div className="h-80 animate-pulse rounded-xl bg-pub-border lg:h-96" />
        </div>
      </div>
    </div>
  );
}

// ── Locale-aware content (streams in, cached per locale by cacheComponents) ──
async function HomeContent() {
  const { locale, t } = await getServerI18n();
  const year = new Date().getFullYear();
  const shots = PRODUCT_SHOTS;

  const steps: WorkflowStep[] = FLOW.map((s, i) => ({
    id: s.id,
    number: String(i + 1).padStart(2, "0"),
    title: t(s.title),
    text: t(s.text),
    image: { ...shots[s.id], alt: t(shots[s.id].altKey) },
  }));

  return (
    <>
      <a href="#konten" className="pub-skip">
        {t("pub.skip")}
      </a>
      <PublicHeader locale={locale} t={t} />

      <main id="konten" tabIndex={-1} className="flex-1 outline-none">
        {/* ── 6.1 Hero ─────────────────────────────────────────────── */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden">
          <div className="pub-light" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:px-8 lg:pb-28 lg:pt-20">
            <div>
              <p className="pub-eyebrow">{t("landing.hero.eyebrow")}</p>
              <h1 id="hero-title" className="pub-display pub-display-xl mt-5 text-pub-text">
                {t("landing.hero.title")}
              </h1>
              <p className="pub-body-l pub-prose mt-6 text-pub-muted">{t("landing.hero.lead")}</p>
              <div className="mt-9">
                <ContactButtons t={t} />
              </div>
              <p className="mt-6 text-[0.9375rem] text-pub-muted">
                <Link href="/login" className="pub-link-quiet">
                  {t("landing.hero.signin")} →
                </Link>
              </p>
            </div>

            <figure className="relative mt-16 lg:mt-20">
              {/* The motif rises behind the frame: its graduations, band and needle show above it. */}
              <PrecisionScale className="pointer-events-none absolute left-1/2 top-0 w-[110%] max-w-none -translate-x-1/2 -translate-y-[34%] opacity-80" />
              <div className="pub-frame relative">
                <Image
                  src={shots.hero.src}
                  width={shots.hero.width}
                  height={shots.hero.height}
                  alt={t("landing.hero.visualLabel")}
                  priority
                  sizes="(min-width: 1200px) 620px, (min-width: 1024px) 52vw, 92vw"
                  className="h-auto w-full"
                />
              </div>
              <figcaption className="pub-caption relative mt-3 text-pub-subtle">
                {t("landing.hero.sampleCaption")}
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── 6.2 The problem ─────────────────────────────────────── */}
        <section aria-labelledby="problem-title" className="border-y border-pub-border bg-pub-surface/40">
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
            <h2 id="problem-title" className="pub-eyebrow">
              {t("landing.problem.title")}
            </h2>
            <ul className="mt-8 grid gap-8 md:grid-cols-3">
              {(["landing.problem.1", "landing.problem.2", "landing.problem.3"] as const).map((k) => (
                <li key={k} className="pub-display pub-display-m text-pub-text">
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 6.3 Workflow story and capabilities ─────────────────── */}
        <section aria-labelledby="alur-kerja-title" id="alur-kerja" className="scroll-mt-20">
          <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
            <SectionHeading id="alur-kerja-title" eyebrow={t("landing.flow.eyebrow")} title={t("landing.flow.title")} />
            <div className="mt-14">
              <WorkflowStory steps={steps} caption={t("landing.hero.sampleCaption")} />
            </div>
          </div>
        </section>

        <section aria-labelledby="fitur-title" id="fitur" className="scroll-mt-20">
          <div className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6 lg:px-8 lg:pb-32">
            <h2 id="fitur-title" className="pub-display pub-display-m text-pub-text">
              {t("landing.caps.title")}
            </h2>
            <ul className="mt-10 grid gap-px overflow-hidden rounded-xl border border-pub-border bg-pub-border sm:grid-cols-2 lg:grid-cols-3">
              {CAPS.map((k) => (
                <li key={k} className="bg-pub-bg p-6 text-pub-muted">
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 6.4 Compliance and security ──────────────────────────── */}
        <section aria-labelledby="keamanan-title" id="keamanan" className="scroll-mt-20 border-t border-pub-border">
          <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
            <SectionHeading
              id="keamanan-title"
              eyebrow={t("landing.compliance.eyebrow")}
              title={t("landing.compliance.title")}
            />
            <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-16">
              <div>
                <h3 className="text-lg font-semibold text-pub-text">{t("landing.compliance.standardsTitle")}</h3>
                <ul className="mt-6 space-y-5 text-pub-muted">
                  {(
                    ["landing.compliance.iso17025", "landing.compliance.part11", "landing.compliance.accreditation"] as const
                  ).map((k) => (
                    <li key={k} className="border-l border-pub-border-strong pl-4">
                      {t(k)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pub-text">{t("landing.security.title")}</h3>
                <ul className="mt-6 space-y-5 text-pub-muted">
                  {SECURITY.map((k) => (
                    <li key={k} className="border-l border-pub-border-strong pl-4">
                      {t(k)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="pub-caption pub-prose mt-14 text-pub-subtle">{t("landing.compliance.disclaimer")}</p>
          </div>
        </section>

        {/* ── 6.5 Public certificate verification ─────────────────── */}
        <section aria-labelledby="verifikasi-title" id="verifikasi" className="scroll-mt-20 border-t border-pub-border bg-pub-surface/40">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-32">
            <div>
              <SectionHeading id="verifikasi-title" eyebrow={t("landing.verify.eyebrow")} title={t("landing.verify.title")} />
              <p className="pub-body-l pub-prose mt-6 text-pub-muted">{t("landing.verify.lead")}</p>
              {CERTIFICATE_LOOKUP_ENABLED ? (
                // A plain GET form: /verify?number=… redirects to /verify/<number>. Works without JS.
                <form method="get" action="/verify" className="mt-8 max-w-md">
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
                      className="pub-input pub-mono"
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
                <p className="mt-8 flex items-start gap-3 text-pub-muted">
                  <QrCode className="mt-1 h-5 w-5 shrink-0 text-pub-accent" aria-hidden="true" />
                  <span>{t("landing.flow.verify")}</span>
                </p>
              )}
            </div>
            <figure className="mx-auto w-full max-w-[20rem]">
              <div className="rounded-[2.25rem] border border-pub-border-strong bg-pub-raised p-2.5">
                <div className="overflow-hidden rounded-[1.75rem] border border-pub-border">
                  <Image
                    src={shots.verify.src}
                    width={shots.verify.width}
                    height={shots.verify.height}
                    alt={t("landing.verify.phoneLabel")}
                    sizes="320px"
                    className="h-auto w-full"
                  />
                </div>
              </div>
              <figcaption className="pub-caption mt-3 text-center text-pub-subtle">
                {t("landing.hero.sampleCaption")}
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── 6.6 How we work ─────────────────────────────────────── */}
        <section aria-labelledby="work-title" className="border-t border-pub-border">
          <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8">
            <h2 id="work-title" className="pub-display pub-display-m text-pub-text">
              {t("landing.work.title")}
            </h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {(["landing.work.step1", "landing.work.step2", "landing.work.step3"] as const).map((k, i) => (
                <li key={k} className="pub-card p-6">
                  <span className="pub-mono text-sm text-pub-subtle">{String(i + 1).padStart(2, "0")}</span>
                  <p className="mt-2 text-lg font-semibold text-pub-text">{t(k)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 6.7 FAQ: native <details>, no script ─────────────────── */}
        <section aria-labelledby="faq-title" id="faq" className="scroll-mt-20 border-t border-pub-border">
          <div className="mx-auto max-w-[860px] px-4 py-24 sm:px-6 lg:px-8">
            <h2 id="faq-title" className="pub-display pub-display-m text-pub-text">
              {t("landing.faq.title")}
            </h2>
            <div className="mt-10 divide-y divide-pub-border border-y border-pub-border">
              {FAQ.map(([q, a]) => (
                <details key={q} className="pub-faq group">
                  <summary className="flex items-center justify-between gap-6 py-5 text-left text-[1.0625rem] font-medium text-pub-text">
                    <span>{t(q)}</span>
                    <Plus className="pub-faq-icon h-5 w-5 shrink-0 text-pub-accent" aria-hidden="true" />
                  </summary>
                  <p className="pb-6 pr-10 text-pub-muted">{t(a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── 6.8 Contact ─────────────────────────────────────────── */}
        <section aria-labelledby="kontak-title" id="kontak" className="relative scroll-mt-20 overflow-hidden border-t border-pub-border">
          <div className="pub-light" aria-hidden="true" />
          <div className="relative mx-auto max-w-[1200px] px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
            <h2 id="kontak-title" className="pub-display pub-display-l max-w-3xl text-pub-text">
              {t("landing.contact.title")}
            </h2>
            <p className="pub-body-l pub-prose mt-5 text-pub-muted">{t("landing.contact.lead")}</p>
            <div className="mt-9">
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

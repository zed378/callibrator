"use client";

import React, { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import MagneticButton from "@/components/motion/MagneticButton";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

const ticks = ["No credit card required", "14-day free trial", "Cancel anytime"];

export const CtaSection = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [-40, 40]);

  return (
    <section ref={sectionRef} id="cta" className="relative isolate overflow-hidden">
      {/* Photo band + overlays (intentionally dark in both themes) */}
      <motion.div style={{ y: reduced ? 0 : y }} className="absolute inset-0 -z-10 scale-110">
        <Image
          src="/marketing/cta-band.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-center"
        />
      </motion.div>
      <div className="absolute inset-0 -z-10 bg-slate-950/80" />
      <div className="absolute inset-0 -z-10 bg-linear-to-tr from-primary/50 via-slate-950/20 to-transparent" />

      {/* Diagonal sheen sweep */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1/4 bg-linear-to-r from-transparent via-white/10 to-transparent animate-sheen" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 lg:px-8 lg:py-32">
        <span
          data-reveal
          className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/70"
        >
          <span className="h-px w-8 bg-white/50" aria-hidden="true" />
          Start today
        </span>

        <h2
          data-reveal
          style={{ "--reveal-delay": "80ms" } as React.CSSProperties}
          className="mt-6 font-display text-balance text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl"
        >
          Make your next audit the boring one.
        </h2>
        <p
          data-reveal
          style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
          className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/80"
        >
          Bring every device, schedule, and certificate into one place — and
          hand your assessors a folder that&apos;s already complete.
        </p>

        <div
          data-reveal
          style={{ "--reveal-delay": "240ms" } as React.CSSProperties}
          className="mt-10 flex flex-col justify-center gap-3 sm:flex-row"
        >
          <MagneticButton>
            <Link
              href="/login"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-7 py-3.5 text-base font-semibold text-slate-900 shadow-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/90"
            >
              Start free trial
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </MagneticButton>
          <MagneticButton>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-7 py-3.5 text-base font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              Book a walkthrough
            </Link>
          </MagneticButton>
        </div>

        <div
          data-reveal
          style={{ "--reveal-delay": "320ms" } as React.CSSProperties}
          className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/80"
        >
          {ticks.map((t) => (
            <span key={t} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-white" strokeWidth={2.5} />
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CtaSection;

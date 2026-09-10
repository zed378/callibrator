"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, type Variants } from "motion/react";
import { ArrowRight, ArrowDownRight } from "lucide-react";
import { Eyebrow } from "./_shared/Eyebrow";
import { heroStats } from "@/data/landing";
import HeroPoster from "./hero/HeroPoster";
import AuroraBackground from "@/components/motion/AuroraBackground";
import MagneticButton from "@/components/motion/MagneticButton";
import Counter from "@/components/motion/Counter";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

// Illustrative team faces (see public/marketing/CREDITS.md) — the human, "real
// people behind the platform" note that warms up the precision story.
const avatars = [
  "/marketing/avatar-1.jpg",
  "/marketing/avatar-2.jpg",
  "/marketing/avatar-3.jpg",
  "/marketing/avatar-4.jpg",
];

export const HeroSection = () => {
  const reduced = useReducedMotionSafe();

  return (
    <section className="relative overflow-hidden">
      <AuroraBackground />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 pt-32 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pt-36 lg:pb-28">
          {/* ── Left: the pitch ── */}
          <motion.div
            variants={container}
            initial={reduced ? false : "hidden"}
            animate="show"
          >
            {/* Live status — measurements landing within tolerance right now */}
            <motion.div variants={item} className="mb-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                <span className="tabular-nums">12,000+</span> instruments
                calibrated within tolerance
              </span>
            </motion.div>

            <motion.div variants={item}>
              <Eyebrow>ISO 17025 · Traceable standards · Multi-tenant</Eyebrow>
            </motion.div>

            <motion.h1
              variants={item}
              className="mt-6 font-display text-balance text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl"
            >
              Every instrument measured.
              <br />
              Every result{" "}
              <span className="bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                traceable.
              </span>
            </motion.h1>

            <motion.p
              variants={item}
              className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground"
            >
              Schedule the work, capture readings against traceable reference
              standards, and issue tamper-evident certificates — so every
              measurement holds up the day an auditor asks.
            </motion.p>

            <motion.div
              variants={item}
              className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <MagneticButton>
                <Link
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-r from-primary to-accent px-6 py-3.5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-primary/40"
                >
                  Start free trial
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </MagneticButton>
              <a
                href="#how-it-works"
                className="group inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-5 py-3.5 text-base font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-muted"
              >
                See how it works
                <ArrowDownRight className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              </a>
            </motion.div>

            {/* Human trust cluster — real faces + a warm, specific claim */}
            <motion.div
              variants={item}
              className="mt-8 flex items-center gap-4"
            >
              <div className="flex -space-x-3">
                {avatars.map((src) => (
                  <span
                    key={src}
                    className="relative h-10 w-10 overflow-hidden rounded-full ring-2 ring-background"
                  >
                    <Image
                      src={src}
                      alt=""
                      fill
                      sizes="40px"
                      // Tiny (~5 KB) thumbnails: skip the image optimizer so they
                      // load instantly and reliably, even after client-side nav.
                      unoptimized
                      className="object-cover"
                    />
                  </span>
                ))}
              </div>
              <p className="text-sm leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">
                  Trusted by biomedical &amp; calibration engineers
                </span>
                <br className="hidden sm:block" />
                preparing for ISO 17025 &amp; KARS with confidence.
              </p>
            </motion.div>

            {/* Glass stat cards — numbers count up on view */}
            <motion.dl
              variants={item}
              className="mt-10 grid max-w-lg grid-cols-3 gap-3"
            >
              {heroStats.map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm transition-colors hover:border-primary/40"
                >
                  <dt className="font-display text-2xl font-bold tracking-tight text-foreground tabular-nums sm:text-3xl">
                    <Counter value={s.value} />
                  </dt>
                  <dd className="mt-1 text-xs leading-snug text-muted-foreground">
                    {s.label}
                  </dd>
                </div>
              ))}
            </motion.dl>
          </motion.div>

          {/* ── Right: a calibration close-up + proof chips ──
              Deliberately NOT WebGL: a re-mounted canvas can silently blank
              after a client-side redirect (context loss doesn't throw, so it
              can't be caught), and the image is served unoptimized so the Next
              image endpoint can't fail it either. Rock-solid, no white box. ── */}
          <div className="animate-fade-in delay-200">
            <HeroPoster />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;

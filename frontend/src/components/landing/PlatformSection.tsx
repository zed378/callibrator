"use client";

import React, { useRef } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { Eyebrow } from "./_shared/Eyebrow";
import { SectionHeading } from "./_shared/SectionHeading";
import { platformCapabilities } from "@/data/landing";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

export const PlatformSection = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [36, -36]);

  return (
    <section
      ref={sectionRef}
      id="platform"
      className="bg-background py-24 lg:py-32"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Product visual in a browser frame */}
          <div data-reveal="left" className="group relative order-2 lg:order-1">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-destructive/60" />
                <span className="h-3 w-3 rounded-full bg-warning/60" />
                <span className="h-3 w-3 rounded-full bg-success/60" />
                <span className="ml-3 hidden rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground sm:inline">
                  app.hdc.health / dashboard
                </span>
              </div>
              <div className="relative aspect-16/10 overflow-hidden">
                <motion.div style={{ y: reduced ? 0 : y }} className="absolute inset-0 scale-110">
                  <Image
                    src="/marketing/platform-dashboard.jpg"
                    alt="Analytics dashboard showing calibration trends"
                    fill
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    className="object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
                  />
                </motion.div>
              </div>
            </div>

            {/* Orbiting live-status chips */}
            <div className="pointer-events-none absolute -right-3 top-8 z-10 hidden items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 shadow-lg backdrop-blur-sm animate-float sm:flex">
              <span className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-semibold text-foreground">In tolerance</span>
            </div>
            <div className="pointer-events-none absolute -left-4 bottom-10 z-10 hidden items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 shadow-lg backdrop-blur-sm animate-float-reverse sm:flex">
              <span className="h-2.5 w-2.5 rounded-full bg-warning animate-pulse" />
              <span className="text-xs font-semibold text-foreground">Due soon</span>
            </div>
          </div>

          {/* Copy + capabilities */}
          <div
            data-reveal="right"
            style={{ "--reveal-delay": "120ms" } as React.CSSProperties}
            className="order-1 lg:order-2"
          >
            <Eyebrow>The platform</Eyebrow>
            <SectionHeading className="mt-5">
              One console for every facility you run.
            </SectionHeading>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Past the calibration basics, HDC gives leadership the visibility
              and the plumbing to run device compliance at scale.
            </p>

            <ul className="mt-10 space-y-6">
              {platformCapabilities.map((cap) => {
                const Icon = cap.icon;
                return (
                  <li key={cap.title} className="flex gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold tracking-tight text-foreground">
                        {cap.title}
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {cap.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PlatformSection;

"use client";

import React, { useRef } from "react";
import Image from "next/image";
import { Gauge } from "lucide-react";
import { Eyebrow } from "./_shared/Eyebrow";
import { SectionHeading } from "./_shared/SectionHeading";
import { Underline } from "./_shared/Underline";
import { features, type Feature } from "@/data/landing";
import TiltCard from "@/components/motion/TiltCard";

function FeatureCell({ feature, index = 0 }: { feature: Feature; index?: number }) {
  const Icon = feature.icon;
  return (
    <div
      data-reveal
      style={{ "--reveal-delay": `${index * 70}ms` } as React.CSSProperties}
      className="h-full"
    >
      <TiltCard
        max={5}
        className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors duration-300 hover:border-primary/30"
      >
        <div className="flex items-center justify-between">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {feature.tag}
          </span>
        </div>
        <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
          {feature.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {feature.description}
        </p>
      </TiltCard>
    </div>
  );
}

export const FeaturesSection = () => {
  const gridRef = useRef<HTMLDivElement>(null);

  // Cursor spotlight: feed pointer position into CSS vars read by the overlay.
  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = gridRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
    el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
    el.style.setProperty("--spot-opacity", "1");
  }
  function handleLeave() {
    gridRef.current?.style.setProperty("--spot-opacity", "0");
  }

  return (
    <section id="features" className="bg-muted/40 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="max-w-2xl">
          <Eyebrow>What you get</Eyebrow>
          <SectionHeading className="mt-5">
            The tools a biomedical team actually{" "}
            <Underline>reaches for.</Underline>
          </SectionHeading>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            No feature-list padding — just the capabilities that keep a fleet
            compliant and a team out of firefighting mode.
          </p>
        </div>

        {/* Bento grid + cursor spotlight */}
        <div
          ref={gridRef}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          className="relative mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-30 rounded-2xl transition-opacity duration-500 mix-blend-soft-light"
            style={{
              opacity: "var(--spot-opacity, 0)",
              background:
                "radial-gradient(340px circle at var(--spot-x, 50%) var(--spot-y, 50%), color-mix(in oklab, var(--primary) 55%, transparent), transparent 62%)",
            }}
          />
          <FeatureCell feature={features[0]} index={0} />
          <FeatureCell feature={features[1]} index={1} />

          {/* Tall photo cell (spans two rows on desktop) */}
          <div
            data-reveal
            style={{ "--reveal-delay": "140ms" } as React.CSSProperties}
            className="group relative min-h-64 overflow-hidden rounded-2xl ring-1 ring-border sm:col-span-2 lg:col-span-1 lg:row-span-2"
          >
            <Image
              src="/marketing/feature-monitoring.jpg"
              alt="Patient monitor displaying live vital-sign readings"
              fill
              sizes="(max-width: 1024px) 100vw, 33vw"
              className="object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-linear-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
                Monitoring
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                Live device status across the whole fleet
              </p>
            </div>
          </div>

          <FeatureCell feature={features[2]} index={3} />
          <FeatureCell feature={features[3]} index={4} />

          {/* Accent statement cell */}
          <div
            data-reveal
            style={{ "--reveal-delay": "350ms" } as React.CSSProperties}
            className="flex flex-col justify-between rounded-2xl bg-primary p-6 text-primary-foreground sm:col-span-2 lg:col-span-1"
          >
            <Gauge className="h-7 w-7 opacity-90" />
            <div className="mt-8">
              <p className="text-xl font-bold leading-snug">
                Inside tolerance, on time.
              </p>
              <p className="mt-2 text-sm text-primary-foreground/80">
                Every device, every interval — tracked so nothing drifts
                unnoticed.
              </p>
            </div>
          </div>

          <FeatureCell feature={features[4]} index={6} />
          <FeatureCell feature={features[5]} index={7} />
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;

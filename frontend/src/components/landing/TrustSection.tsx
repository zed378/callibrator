"use client";

import React from "react";
import { partners } from "@/data/landing";
import Marquee from "@/components/motion/Marquee";

const certifications = ["ISO 17025", "HIPAA", "KARS", "SNARS", "SOC 2"];

export const TrustSection = () => {
  return (
    <section id="trust" className="border-y border-border bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <p
          data-reveal
          className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
        >
          Trusted by biomedical &amp; quality teams across healthcare
        </p>

        {/* Monochrome wordmark strip — now an infinite, pause-on-hover marquee */}
        <div data-reveal className="mt-8">
          <Marquee durationSec={38}>
            {partners.map((name) => (
              <span
                key={name}
                className="whitespace-nowrap px-8 text-lg font-semibold tracking-tight text-muted-foreground/60 transition-colors hover:text-foreground sm:text-xl"
              >
                {name}
              </span>
            ))}
          </Marquee>
        </div>

        {/* Certification chips */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {certifications.map((c, i) => (
            <span
              key={c}
              data-reveal
              style={{ "--reveal-delay": `${i * 60}ms` } as React.CSSProperties}
              className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold tracking-wide text-foreground transition-transform hover:-translate-y-0.5"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustSection;

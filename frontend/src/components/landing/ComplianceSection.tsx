"use client";

import React, { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { Eyebrow } from "./_shared/Eyebrow";
import { SectionHeading } from "./_shared/SectionHeading";
import { MediaFrame } from "./_shared/MediaFrame";
import { accreditations, complianceChecklist } from "@/data/landing";
import { registerGsap } from "@/components/motion/gsap";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

export const ComplianceSection = () => {
  const listRef = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotionSafe();

  // Draw each check when the list scrolls into view (per-item stagger via the
  // path's transition-delay). Reduced motion shows them drawn immediately.
  useGSAP(
    () => {
      const list = listRef.current;
      if (reduced || !list) return;
      const { ScrollTrigger } = registerGsap();
      const paths = list.querySelectorAll<SVGPathElement>(".compliance-check");
      const trigger = ScrollTrigger.create({
        trigger: list,
        start: "top 80%",
        once: true,
        onEnter: () => paths.forEach((p) => p.classList.add("is-drawn")),
      });
      return () => trigger.kill();
    },
    { scope: listRef, dependencies: [reduced] },
  );

  return (
    <section id="compliance" className="bg-muted/40 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Copy + checklist */}
          <div data-reveal>
            <Eyebrow>Compliance</Eyebrow>
            <SectionHeading className="mt-5">
              Walk into the audit already prepared.
            </SectionHeading>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Every record is traceable, signed, and time-stamped as work
              happens — so an inspection is an export, not a fire drill.
            </p>

            <ul ref={listRef} className="mt-8 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {complianceChecklist.map((item, i) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path
                        className="compliance-check draw-path"
                        pathLength={1}
                        style={{ transitionDelay: `${i * 80}ms` }}
                        d="M4 12.5 L10 18 L20 6"
                      />
                    </svg>
                  </span>
                  <span className="text-sm leading-snug text-foreground">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Photo */}
          <div
            data-reveal="right"
            style={{ "--reveal-delay": "120ms" } as React.CSSProperties}
          >
            <MediaFrame
              src="/marketing/compliance-audit.jpg"
              alt="Two people reviewing and signing compliance documents"
              aspect="3 / 2"
              sizes="(max-width: 1024px) 100vw, 50vw"
            >
              <div className="absolute -left-4 -top-4 rounded-2xl border border-border bg-card px-4 py-3 shadow-xl sm:-left-6">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Audit prep
                </div>
                <div className="mt-0.5 text-lg font-bold text-foreground">
                  Days → minutes
                </div>
              </div>
            </MediaFrame>
          </div>
        </div>

        {/* Accreditation cards */}
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {accreditations.map((acc, i) => (
            <div
              key={acc.code}
              data-reveal
              style={{ "--reveal-delay": `${i * 80}ms` } as React.CSSProperties}
              className="rounded-2xl border border-border bg-card p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/30"
            >
              <span className="inline-flex rounded-lg bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                {acc.code}
              </span>
              <h3 className="mt-4 font-semibold tracking-tight text-foreground">
                {acc.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {acc.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ComplianceSection;

"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import { ArrowRight } from "lucide-react";
import { Eyebrow } from "./_shared/Eyebrow";
import { MediaFrame } from "./_shared/MediaFrame";
import { steps } from "@/data/landing";
import SplitHeading from "@/components/motion/SplitHeading";
import { registerGsap } from "@/components/motion/gsap";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

export const HowItWorksSection = () => {
  const stepsRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();

  useGSAP(
    () => {
      const container = stepsRef.current;
      const fill = fillRef.current;
      if (reduced || !container) return;
      const { gsap, ScrollTrigger } = registerGsap();

      // Rail fills as the steps block scrolls through the viewport.
      if (fill) {
        gsap.fromTo(
          fill,
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: "none",
            scrollTrigger: { trigger: container, start: "top 60%", end: "bottom 65%", scrub: true },
          },
        );
      }

      // Each step number lights up when it reaches ~70% and stays lit (progress).
      const nums = container.querySelectorAll<HTMLElement>(".hiw-num");
      const triggers = Array.from(nums).map((el) =>
        ScrollTrigger.create({
          trigger: el,
          start: "top 72%",
          onEnter: () => el.classList.add("is-active"),
          onLeaveBack: () => el.classList.remove("is-active"),
        }),
      );

      return () => triggers.forEach((t) => t.kill());
    },
    { scope: stepsRef, dependencies: [reduced] },
  );

  return (
    <section id="how-it-works" className="bg-background py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header — left-aligned, editorial */}
        <div data-reveal className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <SplitHeading
            as="h2"
            className="mt-5 font-display text-balance font-bold leading-[1.08] tracking-tight text-foreground text-3xl sm:text-4xl lg:text-[2.75rem]"
          >
            From loading dock to signed certificate — four steps.
          </SplitHeading>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            The same lifecycle every regulated device goes through, minus the
            spreadsheets and the last-minute audit panic.
          </p>
        </div>

        {/* Alternating steps + progress rail */}
        <div
          ref={stepsRef}
          className="relative mt-16 space-y-16 lg:mt-24 lg:space-y-28 lg:pl-16"
        >
          {/* Left progress rail (large screens only) */}
          <div
            className="pointer-events-none absolute left-3 top-2 hidden h-[calc(100%-1rem)] w-px bg-border lg:block"
            aria-hidden="true"
          >
            <div
              ref={fillRef}
              className="hiw-rail-fill absolute inset-x-0 top-0 h-full w-px bg-linear-to-b from-primary to-accent"
            />
          </div>

          {steps.map((step, i) => {
            const imageRight = i % 2 === 0;
            return (
              <div
                key={step.no}
                className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
              >
                {/* Text */}
                <div
                  data-reveal={imageRight ? "left" : "right"}
                  className={imageRight ? "lg:order-1" : "lg:order-2"}
                >
                  <div className="flex items-baseline gap-4">
                    <span className="hiw-num text-5xl font-bold tracking-tighter text-primary/25 tabular-nums">
                      {step.no}
                    </span>
                    <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    {step.title}
                  </h3>
                  <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                {/* Photo */}
                <div
                  data-reveal={imageRight ? "right" : "left"}
                  style={{ "--reveal-delay": "120ms" } as React.CSSProperties}
                  className={imageRight ? "lg:order-2" : "lg:order-1"}
                >
                  <MediaFrame
                    src={step.image}
                    alt={step.alt}
                    aspect={step.aspect}
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    className="mx-auto max-w-md lg:max-w-none"
                    frameClassName={i % 2 === 0 ? "rotate-[0.5deg]" : "-rotate-[0.5deg]"}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-16 lg:mt-20">
          <Link
            href="#features"
            className="group inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            See everything the platform does
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;

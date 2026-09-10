"use client";

import React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Eyebrow } from "./_shared/Eyebrow";
import { SectionHeading } from "./_shared/SectionHeading";
import { pricingTiers } from "@/data/landing";

export const PricingSection = () => {
  return (
    <section id="pricing" className="bg-muted/40 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="max-w-2xl">
          <Eyebrow>Pricing</Eyebrow>
          <SectionHeading className="mt-5">
            Plans that scale with your fleet.
          </SectionHeading>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Start with a 14-day free trial — no credit card. Move up as you add
            devices and facilities.
          </p>
        </div>

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-3">
          {pricingTiers.map((tier, i) => {
            const Icon = tier.icon;
            const isFeatured = tier.featured;

            return (
              <div
                key={tier.name}
                data-reveal
                style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
                className={`group/tier relative flex h-full flex-col rounded-[2rem] p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl ${isFeatured
                    ? "bg-card ring-2 ring-primary shadow-xl shadow-primary/20 lg:-mt-4 lg:pb-12"
                    : "bg-card border border-border/80 hover:border-primary/40 shadow-sm"
                  }`}
              >
                {/* Featured tier: soft glow ring + gradient wash */}
                {isFeatured && (
                  <>
                    <div
                      className="pointer-events-none absolute -inset-px -z-10 rounded-[2rem] bg-linear-to-b from-primary/40 to-accent/40 opacity-60 blur-xl transition-opacity duration-500 group-hover/tier:opacity-100"
                      aria-hidden="true"
                    />
                    <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-linear-to-br from-primary/10 via-transparent to-transparent opacity-80" />
                  </>
                )}

                {isFeatured && (
                  <span className="absolute -top-4 left-0 right-0 mx-auto w-fit rounded-full bg-linear-to-r from-primary to-primary/80 px-5 py-1.5 text-xs font-bold uppercase tracking-widest text-primary-foreground shadow-lg shadow-primary/30">
                    Most popular
                  </span>
                )}

                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex items-center gap-4">
                    <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${isFeatured ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "bg-primary/10 text-primary"} transition-colors duration-300`}>
                      <Icon className="h-7 w-7" />
                    </span>
                    <h3 className="text-2xl font-bold tracking-tight text-foreground">
                      {tier.name}
                    </h3>
                  </div>

                  <p className="mt-5 text-sm text-muted-foreground leading-relaxed">
                    {tier.blurb}
                  </p>

                  <div className="my-8 h-[1px] w-full bg-border/50 transition-colors group-hover/tier:bg-border" />

                  <ul className="flex-1 space-y-4">
                    {tier.features.map((f, j) => (
                      <li key={f} className="flex items-start gap-3 text-sm transition-transform duration-300 group-hover/tier:translate-x-1" style={{ transitionDelay: `${j * 40}ms` }}>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isFeatured ? "bg-primary/20 text-primary" : "bg-muted text-foreground/70 group-hover/tier:text-primary group-hover/tier:bg-primary/10"} transition-colors duration-300`}>
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                        <span className="text-foreground/80 font-medium">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/login"
                    className={`mt-10 block rounded-xl px-6 py-3.5 text-center text-sm font-bold transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${isFeatured
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90 hover:shadow-primary/50"
                        : "text-foreground ring-1 ring-border hover:bg-muted hover:ring-primary/50"
                      }`}
                  >
                    {tier.cta}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm text-muted-foreground">
          Need something bigger?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Talk to our team
          </Link>{" "}
          about network-wide deployments.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;

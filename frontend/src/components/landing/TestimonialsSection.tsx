"use client";

import React from "react";
import Image from "next/image";
import { Star, Quote } from "lucide-react";
import { Eyebrow } from "./_shared/Eyebrow";
import { SectionHeading } from "./_shared/SectionHeading";
import { testimonials, type Testimonial } from "@/data/landing";

function Stars({ className = "" }: { className?: string }) {
  return (
    <div className={`flex gap-0.5 ${className}`} aria-label="5 out of 5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="h-4 w-4 fill-warning text-warning" />
      ))}
    </div>
  );
}

function Author({
  t,
  size = 40,
}: {
  t: Testimonial;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <Image
        src={t.avatar}
        alt={t.name}
        width={size}
        height={size}
        className="rounded-full object-cover ring-2 ring-border"
        style={{ width: size, height: size }}
      />
      <div>
        <p className="text-sm font-semibold text-foreground">{t.name}</p>
        <p className="text-xs text-muted-foreground">
          {t.role}, {t.company}
        </p>
      </div>
    </div>
  );
}

function SmallCard({
  t,
  index = 0,
  className = "",
}: {
  t: Testimonial;
  index?: number;
  className?: string;
}) {
  return (
    <figure
      data-reveal
      style={{ "--reveal-delay": `${index * 90}ms` } as React.CSSProperties}
      className={`flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/30 ${className}`}
    >
      <Stars />
      <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground">
        &ldquo;{t.quote}&rdquo;
      </blockquote>
      <figcaption className="mt-6 border-t border-border pt-4">
        <Author t={t} />
      </figcaption>
    </figure>
  );
}

export const TestimonialsSection = () => {
  const [featured, ...rest] = testimonials;

  return (
    <section id="testimonials" className="bg-background py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="max-w-2xl">
          <Eyebrow>In their words</Eyebrow>
          <SectionHeading className="mt-5">
            What teams say after they make the switch.
          </SectionHeading>
        </div>

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {/* Featured */}
          <figure
            data-reveal
            className="flex flex-col justify-between rounded-2xl border border-primary/20 bg-primary/4 p-8 lg:row-span-2"
          >
            <div>
              <Quote className="h-9 w-9 text-primary/30" />
              <blockquote className="mt-5 text-xl font-medium leading-relaxed text-foreground">
                &ldquo;{featured.quote}&rdquo;
              </blockquote>
            </div>
            <figcaption className="mt-8">
              <Stars className="mb-4" />
              <Author t={featured} size={52} />
            </figcaption>
          </figure>

          <SmallCard t={rest[0]} index={1} />
          <SmallCard t={rest[1]} index={2} />
          <SmallCard t={rest[2]} index={3} className="lg:col-span-2" />
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;

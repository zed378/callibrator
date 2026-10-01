"use client";
/**
 * P10-03 (doc 20 §6.3): the six-step workflow story. On desktop, a list of
 * steps on the left and a sticky product crop on the right that follows the
 * step being read (one IntersectionObserver, CSS `position: sticky`; no
 * scroll-jacking). On mobile, and under reduced motion, it is a plain vertical
 * list with each crop under its step. Every step's text is server-rendered and
 * always visible: the observer only chooses which crop the sticky frame shows.
 */
import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";

export interface WorkflowStep {
  id: string;
  number: string;
  title: string;
  text: string;
  image: { src: string; alt: string; width: number; height: number };
}

export function WorkflowStory({ steps, caption }: { steps: WorkflowStep[]; caption: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const items = refs.current.filter((el): el is HTMLLIElement => Boolean(el));
    if (items.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (Number.isInteger(index)) setActive(index);
          }
        }
      },
      // A step counts as "being read" when it crosses the middle band of the viewport.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const current = steps[active] ?? steps[0];

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <ol className="space-y-10 lg:space-y-[28vh] lg:py-[12vh]">
        {steps.map((step, i) => (
          <li
            key={step.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-index={i}
            className={`border-l-2 pl-5 transition-colors lg:pl-6 ${
              i === active ? "border-pub-accent" : "border-pub-border"
            }`}
          >
            <p className="pub-mono text-sm text-pub-subtle">{step.number}</p>
            <h3 className="mt-1 text-xl font-semibold text-pub-text">{step.title}</h3>
            <p className="mt-2 max-w-md text-pub-muted">{step.text}</p>
            {/* Mobile: the crop sits under its step. */}
            <figure className="pub-frame mt-5 lg:hidden">
              <Image
                src={step.image.src}
                alt={step.image.alt}
                width={step.image.width}
                height={step.image.height}
                sizes="(max-width: 1024px) 92vw, 1px"
                className="h-auto w-full"
              />
            </figure>
          </li>
        ))}
      </ol>
      <div className="hidden lg:block">
        <figure className="sticky top-24">
          <div className="pub-frame">
            <Image
              key={current.id}
              src={current.image.src}
              alt={current.image.alt}
              width={current.image.width}
              height={current.image.height}
              sizes="(min-width: 1024px) 640px, 1px"
              className="h-auto w-full"
            />
          </div>
          <figcaption className="pub-caption mt-3 text-pub-subtle">{caption}</figcaption>
        </figure>
      </div>
    </div>
  );
}

export default WorkflowStory;

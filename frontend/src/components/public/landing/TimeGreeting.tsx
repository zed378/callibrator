"use client";
/**
 * P10-17 (ADR-118 §3): the hero's greeting follows the visitor's own clock.
 * The server cannot know the visitor's time zone, so it renders the neutral
 * word ("Halo" / "Hello"); after hydration the client shows the time-of-day
 * word. Same line, same box: no layout shift worth the name, and the text is
 * never hidden. `useSyncExternalStore` gives the server snapshot during
 * hydration and the clock's afterwards, without a setState-in-effect.
 */
import { useSyncExternalStore } from "react";

export type GreetingPart = "default" | "morning" | "midday" | "afternoon" | "evening";

/** Indonesian day parts: pagi 04–10, siang 11–14, sore 15–17, malam 18–03. */
export const partOfDay = (hour: number): Exclude<GreetingPart, "default"> => {
  if (hour >= 4 && hour < 11) return "morning";
  if (hour >= 11 && hour < 15) return "midday";
  if (hour >= 15 && hour < 18) return "afternoon";
  return "evening";
};

const subscribe = (onChange: () => void) => {
  // Re-read once a minute: a page left open past a boundary changes its word.
  const id = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(id);
};
const clientSnapshot = (): GreetingPart => partOfDay(new Date().getHours());
const serverSnapshot = (): GreetingPart => "default";

export function TimeGreeting({ words }: { words: Record<GreetingPart, string> }) {
  const part = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return <span data-part={part}>{words[part]}</span>;
}

export default TimeGreeting;

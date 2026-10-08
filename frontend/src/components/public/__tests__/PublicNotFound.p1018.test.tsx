/** @jest-environment jsdom */
/**
 * P10-18 (ADR-131 decision 4): the 404s, one per sheet.
 *
 *  - PublicNotFound (app/global-not-found.tsx for an unmatched URL, and
 *    app/(public)/not-found.tsx for a missing blog/news post) is drawn on the
 *    public surface with the `--pub-*` tokens only — the public root layout
 *    loads no dashboard CSS, so a dashboard utility here would render unstyled;
 *  - the signed-in application's 404 (app/(app)/not-found.tsx) keeps the
 *    dashboard look;
 *  - each is one <main> with one <h1>, the same words and the same two ways out,
 *    and axe-clean;
 *  - the public document's font variables include the public faces and the
 *    shared mono face (fonts/publicVariables.ts).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

// next/font is a build-time transform; Jest only needs the class names.
jest.mock("@/app/fonts/public", () => ({
  publicDisplayFont: { variable: "font-pub-display" },
  publicDisplayItalicFont: { variable: "font-pub-display-italic" },
  publicBodyFont: { variable: "font-pub-sans" },
}));
jest.mock("next/font/google", () => ({
  JetBrains_Mono: () => ({ variable: "font-jetbrains" }),
}));

import { PublicNotFound } from "../PublicNotFound";
import PublicGroupNotFound, { metadata as publicMetadata } from "@/app/(public)/not-found";
import AppNotFound from "@/app/(app)/not-found";
import { PUBLIC_FONT_VARIABLES } from "@/app/fonts/publicVariables";

/** Dashboard-sheet utilities that do not exist on the public sheet. */
const DASHBOARD_TOKENS = /\b(?:bg|text|border|ring)-(?:background|foreground|card|muted|muted-foreground|primary|destructive|success|border)\b|\bfont-display\b/;

describe("P10-18: the 404 pages", () => {
  it("the public 404 is one landmark and one heading on the public surface, with no dashboard utility", async () => {
    const { container } = render(<PublicNotFound />);
    expect(container.firstElementChild).toHaveAttribute("data-surface", "public");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This page is off the scale.");
    expect(screen.getByRole("link", { name: /Back to home/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /Open dashboard/ })).toHaveAttribute("href", "/dashboard");
    const classes = [...container.querySelectorAll("[class]")].map((el) => el.getAttribute("class")).join(" ");
    expect(classes).not.toMatch(DASHBOARD_TOKENS);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a notFound() inside the public group renders the same page, titled as a 404", () => {
    render(<PublicGroupNotFound />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This page is off the scale.");
    expect(publicMetadata.title).toMatch(/^404/);
  });

  it("the signed-in application's 404 keeps the dashboard look and the same words", () => {
    const { container } = render(<AppNotFound />);
    expect(container.querySelector("[data-surface]")).toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This page is off the scale.");
  });

  it("the public document carries the public faces and the shared mono face", () => {
    expect(PUBLIC_FONT_VARIABLES.split(" ")).toEqual(["font-pub-display", "font-pub-display-italic", "font-pub-sans", "font-jetbrains"]);
  });
});

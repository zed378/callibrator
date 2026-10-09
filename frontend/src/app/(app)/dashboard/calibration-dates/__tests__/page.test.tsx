/** @jest-environment jsdom */
/**
 * P22-05 — the page's server half: the request's locale, and only the `calibrationDates.` namespace
 * handed to the client island; the title in that language; the language toggle as a form posting
 * to `setLocale` (the current option marked, each named in its own language).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "en", messages: en, t: createTranslator(en) })),
}));
jest.mock("@/i18n/actions", () => ({ setLocale: jest.fn() }));
const island = jest.fn();
jest.mock("../CalibrationDatesClient", () => ({
  CalibrationDatesClient: (props: { languageForm?: React.ReactNode }) => {
    island(props);
    return <div>{props.languageForm}</div>;
  },
}));
const provided = jest.fn();
jest.mock("@/i18n/MessagesProvider", () => ({
  MessagesProvider: (props: { locale: string; messages: Record<string, string>; children: React.ReactNode }) => {
    provided(props);
    return <>{props.children}</>;
  },
}));

import CalibrationDatesPage, { generateMetadata } from "../page";

describe("P22-05 — /dashboard/calibration-dates (server)", () => {
  it("titles the page in the request's language", async () => {
    expect(await generateMetadata()).toEqual({ title: "Calibration dates" });
  });

  it("hands the island only its namespace, with a language toggle", async () => {
    render(await CalibrationDatesPage());
    expect(island).toHaveBeenCalled();
    const { locale, messages } = provided.mock.calls[0]?.[0] as { locale: string; messages: Record<string, string> };
    expect(locale).toBe("en");
    expect(Object.keys(messages).length).toBeGreaterThan(90);
    expect(Object.keys(messages).every((k) => k.startsWith("calibrationDates."))).toBe(true);
    expect(screen.getByRole("group", { name: "Page language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Bahasa Indonesia" })).toHaveAttribute("lang", "id");
    expect(screen.getByRole("button", { name: "Bahasa Indonesia" })).not.toHaveAttribute("aria-current");
  });
});

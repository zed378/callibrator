/** @jest-environment jsdom */
/**
 * P22-04 — the page's server half: the request's locale, and only the island's namespaces (`ipm.`,
 * the catalogue's section and outcome names) handed to it; the title in that language; the language
 * toggle; `?deviceId=` passed on only when it is one well-formed id.
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
jest.mock("../IpmClient", () => ({
  IpmClient: (props: { deviceId: string | null; languageForm?: React.ReactNode }) => {
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

import IpmPage, { generateMetadata } from "../page";

const DEVICE = "5b000000-0000-4000-8000-000000000001";

describe("P22-04 — /dashboard/ipm (server)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("titles the page in the request's language", async () => {
    expect(await generateMetadata()).toEqual({ title: "IPM history" });
  });

  it("hands the island only its namespaces, with a language toggle; no device without a valid id", async () => {
    render(await IpmPage({}));
    const { locale, messages } = provided.mock.calls[0]?.[0] as { locale: string; messages: Record<string, string> };
    expect(locale).toBe("en");
    expect(Object.keys(messages).length).toBeGreaterThan(100);
    expect(Object.keys(messages).every((k) => k.startsWith("ipm.") || k.startsWith("ipmCatalogue.section.") || k.startsWith("ipmCatalogue.outcome."))).toBe(true);
    expect(messages["ipmCatalogue.section.physical"]).toBe("Physical inspection");
    expect(island.mock.calls[0]?.[0]).toMatchObject({ deviceId: null });
    expect(screen.getByRole("group", { name: "Page language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Bahasa Indonesia" })).not.toHaveAttribute("aria-current");
  });

  it("passes `?deviceId=` on when it is one uuid, and ignores anything else", async () => {
    render(await IpmPage({ searchParams: Promise.resolve({ deviceId: DEVICE }) }));
    expect(island.mock.calls[0]?.[0]).toMatchObject({ deviceId: DEVICE });
    render(await IpmPage({ searchParams: Promise.resolve({ deviceId: "x" }) }));
    expect(island.mock.calls[1]?.[0]).toMatchObject({ deviceId: null });
  });
});

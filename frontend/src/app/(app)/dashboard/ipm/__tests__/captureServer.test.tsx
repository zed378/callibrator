/** @jest-environment jsdom */
/**
 * P22-03 — the start and capture pages' server halves: the title in the request's language, only
 * the IPM namespaces handed to each island, the session id passed on, the language toggle.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "en", messages: en, t: createTranslator(en) })),
}));
jest.mock("@/i18n/actions", () => ({ setLocale: jest.fn() }));
const start = jest.fn();
const capture = jest.fn();
jest.mock("../new/StartClient", () => ({
  StartClient: (props: { languageForm?: React.ReactNode }) => {
    start(props);
    return <div>{props.languageForm}</div>;
  },
}));
jest.mock("../capture/[sessionId]/CaptureClient", () => ({
  CaptureClient: (props: { sessionId: string; languageForm?: React.ReactNode }) => {
    capture(props);
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

import StartPage, { generateMetadata as startMeta } from "../new/page";
import CapturePage, { generateMetadata as captureMeta } from "../capture/[sessionId]/page";

const namespaces = (): boolean => {
  const { messages } = provided.mock.calls.at(-1)?.[0] as { messages: Record<string, string> };
  return Object.keys(messages).every((k) => k.startsWith("ipm.") || k.startsWith("ipmCatalogue.section.") || k.startsWith("ipmCatalogue.outcome."));
};

describe("P22-03 — the start and capture pages (server)", () => {
  it("titles", async () => {
    expect(await startMeta()).toEqual({ title: "Start an IPM" });
    expect(await captureMeta()).toEqual({ title: "IPM capture" });
  });

  it("the start page: the namespaces, the language toggle with the current language marked", async () => {
    render(await StartPage());
    expect(start).toHaveBeenCalled();
    expect(namespaces()).toBe(true);
    expect(screen.getByRole("group", { name: "Page language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Bahasa Indonesia" })).not.toHaveAttribute("aria-current");
  });

  it("the capture page: the session id passed on", async () => {
    render(await CapturePage({ params: Promise.resolve({ sessionId: "s-1" }) }));
    expect(capture.mock.calls[0]?.[0]).toMatchObject({ sessionId: "s-1" });
    expect(namespaces()).toBe(true);
  });
});

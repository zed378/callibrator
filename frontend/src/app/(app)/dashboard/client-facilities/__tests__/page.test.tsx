/** @jest-environment jsdom */
/** P22-09 — the page's server half: its title, only the `facilities.` namespace, the language toggle. */
import React from "react";
import { render, screen } from "@testing-library/react";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "en", messages: en, t: createTranslator(en) })),
}));
jest.mock("@/i18n/actions", () => ({ setLocale: jest.fn() }));
jest.mock("../FacilitiesClient", () => ({ FacilitiesClient: (props: { languageForm?: React.ReactNode }) => <div>{props.languageForm}</div> }));
const provided = jest.fn();
jest.mock("@/i18n/MessagesProvider", () => ({
  MessagesProvider: (props: { messages: Record<string, string>; children: React.ReactNode }) => {
    provided(props);
    return <>{props.children}</>;
  },
}));

import Page, { generateMetadata } from "../page";

describe("P22-09 — /dashboard/client-facilities (server)", () => {
  it("title, namespace, language toggle", async () => {
    expect(await generateMetadata()).toEqual({ title: "Client facilities" });
    render(await Page());
    const { messages } = provided.mock.calls[0]?.[0] as { messages: Record<string, string> };
    expect(Object.keys(messages).every((k) => k.startsWith("facilities."))).toBe(true);
    expect(screen.getByRole("group", { name: "Page language" })).toBeInTheDocument();
  });
});

/** @jest-environment jsdom */
/**
 * P24-06 — the page's server half: the request's locale and only the
 * `sqlImport.` namespace handed to the client island, the title in that
 * language, and the language toggle as a form posting to `setLocale` (the
 * current option marked, each named in its own language).
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
jest.mock("../UpstreamSqlImportClient", () => ({
  UpstreamSqlImportClient: (props: { languageForm?: React.ReactNode }) => {
    island(props);
    return <div>{props.languageForm}</div>;
  },
}));

import UpstreamSqlImportPage, { generateMetadata } from "../page";

describe("P24-06 — /dashboard/upstream-sql-import (server)", () => {
  it("titles the page in the request's language", async () => {
    expect(await generateMetadata()).toEqual({ title: "SQL dump import" });
  });

  it("renders the island with a language toggle, the current language marked", async () => {
    render(await UpstreamSqlImportPage());
    expect(island).toHaveBeenCalled();
    const group = screen.getByRole("group", { name: "Page language" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Bahasa Indonesia" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Bahasa Indonesia" })).toHaveAttribute("lang", "id");
  });
});

/** @jest-environment jsdom */
/**
 * P23-02 — the public verification page's server shell: never indexed, one main, the island inside a
 * Suspense boundary with the verify namespace, the PDF's labels in the page's language.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { id } from "@/i18n/messages/id";
import { createTranslator } from "@/i18n/translate";

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "id", messages: id, t: createTranslator(id) })),
}));
jest.mock("@/components/public/PublicSurface", () => ({ PublicSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("@/components/public/BrandLockup", () => ({ BrandLockup: () => <span>brand</span> }));
jest.mock("@/components/public/LanguageForm", () => ({ LanguageForm: () => <span>language</span> }));
const island = jest.fn();
jest.mock("../VerifyIpmContent", () => ({
  VerifyIpmContent: (props: { pdfMessages: Record<string, string> }) => {
    island(props);
    return <h1>island</h1>;
  },
}));

import IpmVerifyPage, { generateMetadata } from "../page";

describe("P23-02 — /verify/ipm/[reportNumber] (server)", () => {
  it("not indexed; one main; the PDF labels in Indonesian", async () => {
    expect(await generateMetadata()).toEqual({ title: "Verifikasi laporan IPM", robots: { index: false, follow: false } });
    render(await IpmVerifyPage());
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const { pdfMessages } = island.mock.calls[0]?.[0] as { pdfMessages: Record<string, string> };
    expect(pdfMessages["ipmReport.title"]).toBe("IPM — Inspeksi dan Pemeliharaan Preventif");
  });
});

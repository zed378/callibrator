/** @jest-environment jsdom */
/**
 * P23-02 — the report page's server half: its title, the page's namespaces, the session id, and the
 * PDF's labels handed over in BOTH languages (the reader chooses at download).
 */
import React from "react";
import { render } from "@testing-library/react";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "en", messages: en, t: createTranslator(en) })),
}));
jest.mock("@/i18n/actions", () => ({ setLocale: jest.fn() }));
const island = jest.fn();
jest.mock("../sessions/[sessionId]/report/ReportClient", () => ({
  ReportClient: (props: Record<string, unknown>) => {
    island(props);
    return <div />;
  },
}));

import ReportPage, { generateMetadata } from "../sessions/[sessionId]/report/page";

describe("P23-02 — /dashboard/ipm/sessions/<id>/report (server)", () => {
  it("title, the session id, the PDF labels in both languages", async () => {
    expect(await generateMetadata()).toEqual({ title: "IPM report" });
    render(await ReportPage({ params: Promise.resolve({ sessionId: "s-1" }) }));
    const props = island.mock.calls[0]?.[0] as { sessionId: string; pdfMessages: { id: Record<string, string>; en: Record<string, string> } };
    expect(props.sessionId).toBe("s-1");
    expect(props.pdfMessages.id["ipmReport.rec.needs_repair"]).toBe("Alat Harus Diperbaiki");
    expect(props.pdfMessages.en["ipmReport.rec.needs_repair"]).toBe("The device must be repaired");
    expect(Object.keys(props.pdfMessages.en).every((k) => /^(ipmReport\.|ipmCatalogue\.(section|outcome)\.)/.test(k))).toBe(true);
  });
});

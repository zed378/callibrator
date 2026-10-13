/** @jest-environment jsdom */
/**
 * P22-08 — the public device page `/d/[token]` (ADR-138 § 5 – § 7; P19-07 § 10): the shell (never
 * indexed, no referrer, one <main>, the body inside a Suspense boundary), and the body for every
 * outcome — the device (its fields only, the status as a WORD, the notes for retired and overdue,
 * the report link only when the backend sends one), not found, rate-limited, failed — one <h1> each,
 * Indonesian and English; axe.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { id } from "@/i18n/messages/id";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { axeViolations } from "@/tests/a11y/axe";
import type { PublicDevice, PublicDeviceOutcome } from "@/lib/publicDevice.server";

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "id", messages: id, t: createTranslator(id) })),
}));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.9" })) }));
jest.mock("@/components/public/PublicSurface", () => ({ PublicSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("@/components/public/BrandLockup", () => ({ BrandLockup: () => <span>brand</span> }));
jest.mock("@/components/public/LanguageForm", () => ({ LanguageForm: () => <span>language</span> }));
const read = jest.fn<Promise<PublicDeviceOutcome>, [string, Headers]>();
jest.mock("@/lib/publicDevice.server", () => ({ readPublicDevice: (token: string, h: Headers) => read(token, h) }));

import PublicDevicePage, { generateMetadata } from "../page";
import { DeviceContent, formatDay } from "../DeviceContent";

const DEVICE: PublicDevice = {
  device: { name: "Pompa infus sintetis", type: "Pompa infus", manufacturer: "Pembuat", model: "P-1" },
  facility: { name: "Fasilitas Satu" },
  calibration: { status: "current", nextDueDate: "2027-03-01" },
  lastIpmDate: "2026-09-14",
  report: null,
};
const TOKEN = "Zx3kQ9vN2mP4rT6wY8aC1d";

const body = async (outcome: PublicDeviceOutcome, locale: "id" | "en" = "id") => {
  read.mockResolvedValueOnce(outcome);
  const t = createTranslator(locale === "id" ? id : en);
  return render(<main>{await DeviceContent({ params: Promise.resolve({ token: TOKEN }), locale, t })}</main>);
};

beforeEach(() => read.mockReset());

describe("P22-08 — /d/[token] (server)", () => {
  it("the shell: never indexed, no referrer, one main, the loading state while the body streams", async () => {
    expect(await generateMetadata()).toEqual({ title: "Perangkat", robots: { index: false, follow: false }, referrer: "no-referrer" });
    read.mockReturnValueOnce(new Promise(() => undefined));
    render(await PublicDevicePage({ params: Promise.resolve({ token: TOKEN }) }));
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("a device: one h1 (its name), the status as a word, the allow-listed fields, the token sent with the request's headers", async () => {
    const { container } = await body({ kind: "ok", device: DEVICE });
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Pompa infus sintetis"]);
    expect(screen.getAllByText("Terkalibrasi")).toHaveLength(2);
    for (const value of ["Pompa infus", "Pembuat", "P-1", "Fasilitas Satu", "1 Maret 2027", "14 September 2026"]) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(screen.queryByRole("link")).toBeNull();
    const [token, headers] = read.mock.calls[0] ?? [];
    expect([token, headers?.get("x-forwarded-for")]).toEqual([TOKEN, "203.0.113.9"]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("missing fields read 'not recorded'; a retired device says not to use it and shows no next date; the report link when sent", async () => {
    await body({
      kind: "ok",
      device: { ...DEVICE, device: { ...DEVICE.device, type: null, manufacturer: null, model: null }, calibration: { status: "retired", nextDueDate: null }, lastIpmDate: null, report: { verifyUrl: "https://example.test/verify/ipm/IPM-1?t=x" } },
    }, "en");
    expect(screen.getAllByText("Not recorded")).toHaveLength(4);
    expect(screen.getByText("This device is retired. Do not use it.")).toBeTruthy();
    expect(screen.queryByText("Next calibration")).toBeNull();
    const link = screen.getByRole("link", { name: "View the last IPM report’s verification" });
    expect([link.getAttribute("href"), link.getAttribute("rel")]).toEqual(["https://example.test/verify/ipm/IPM-1?t=x", "noreferrer"]);
  });

  it.each([
    ["overdue", "Calibration overdue", "This device’s calibration is overdue. Ask the facility’s staff before using it."],
    ["due_soon", "Calibration due soon", null],
    ["not_scheduled", "Calibration not scheduled", null],
  ] as const)("status %s: its word, and its note when it has one", async (status, word, note) => {
    await body({ kind: "ok", device: { ...DEVICE, calibration: { status, nextDueDate: null } } }, "en");
    expect(screen.getAllByText(word).length).toBe(2);
    if (note) expect(screen.getByText(note)).toBeTruthy();
    else expect(screen.queryByText(/Do not use|overdue\. Ask/)).toBeNull();
  });

  it.each([
    [{ kind: "not_found" } as const, "Tidak ditemukan", "Tidak ada perangkat yang menjawab tautan ini."],
    [{ kind: "rate_limited" } as const, "Terlalu banyak permintaan", "Terlalu banyak tautan dibuka dari jaringan ini. Coba lagi dalam beberapa menit."],
    [{ kind: "failed" } as const, "Status tidak dapat dibaca", "Status perangkat tidak dapat dibaca saat ini. Coba lagi nanti."],
  ])("%o: one h1 and one sentence, nothing about why", async (outcome, title, text) => {
    await body(outcome);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([title]);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole("definition")).toBeNull();
  });

  it("formatDay: the calendar day as written (no zone shift); anything else reads as the fallback", () => {
    expect([formatDay("2026-12-31", "en", "-"), formatDay("2026-12-31T23:00:00Z", "id", "-"), formatDay(null, "en", "-"), formatDay("soon", "en", "-")]).toEqual([
      "31 December 2026",
      "31 Desember 2026",
      "-",
      "-",
    ]);
  });
});

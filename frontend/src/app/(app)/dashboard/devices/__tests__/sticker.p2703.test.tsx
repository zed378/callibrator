/** @jest-environment jsdom */
/**
 * P27-03 — the device sticker's final layout and the re-stickering policy (ADR-138 Am. 4).
 *
 * Real: the layout module (`stickerLayout.ts`), the label, the dialog, the service and the typed
 * client. Mocked: the HTTP client and `qrcode` (jsdom has no canvas); the canvas's 2-D context is a
 * recorder, so what the PNG draws is asserted, not a picture of it.
 *
 * Pins: the label is 60 × 40 mm at 300 dpi; the QR is drawn module by module (every dark module, no
 * other ink in the QR's square); the caption is bilingual whatever the interface language; the name
 * wraps to three lines at most; the footer is the QR number and the issue day; the token is never
 * printed as text; the download is the label (the plain QR without a canvas); print lays the label
 * alone in a `.sticker-print-root` under <body>, gone after; the policy says when to replace and when
 * not, in English and Indonesian; axe.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { device, ok } from "@/tests/support/calibrationDatesFixtures";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

/** A 21 × 21 matrix with a known pattern: dark where (r + c) % 3 === 0. */
const SIZE = 21;
const darkAt = (r: number, c: number) => (r + c) % 3 === 0;
jest.mock("qrcode", () => ({
  __esModule: true,
  default: {
    toDataURL: jest.fn(async () => "data:image/png;base64,UVI="),
    create: jest.fn(() => ({ modules: { size: 21, get: (r: number, c: number) => ((r + c) % 3 === 0 ? 1 : 0) } })),
  },
}));

import { api } from "@/api/client";
import QRCode from "qrcode";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { PRINT_CLASS, PublicLinkDialog } from "../components/PublicLinkDialog";
import {
  LABEL_MM,
  QR_MARGIN,
  STICKER_CAPTION,
  drawLabel,
  footerLine,
  issueDay,
  mmToPx,
  stickerPng,
  wrap,
  type LabelContext,
  type QrMatrix,
} from "../components/stickerLayout";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const create = (QRCode as unknown as { create: jest.Mock }).create;

const LINK = `/api/v1/calibration-devices/${device().id}/public-token`;
const TOKEN = "Zx3kQ9vN2mP4rT6wY8aC1d";
const URL_ = `https://kalibrasi.example.test/d/${TOKEN}`;
const ISSUED_AT = "2026-10-13T02:00:00.000Z";
const LABEL_PNG = "data:image/png;base64,TEFCRUw=";

/** A 2-D context that records every call; a character is 10 px wide. */
const recorder = () => {
  const rects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
  const texts: Array<{ text: string; x: number; y: number; font: string }> = [];
  const ctx: LabelContext = {
    fillStyle: "",
    font: "",
    textBaseline: "alphabetic",
    fillRect(x, y, w, h) {
      rects.push({ x, y, w, h, fill: String(ctx.fillStyle) });
    },
    fillText(text, x, y) {
      texts.push({ text, x, y, font: ctx.font });
    },
    measureText: (s: string) => ({ width: s.length * 10 }) as TextMetrics,
  };
  return { ctx, rects, texts };
};

const matrix: QrMatrix = { size: SIZE, dark: darkAt };
const COLOURS = { paper: "white", ink: "black" };

describe("P27-03 — the layout module", () => {
  it("the label is 60 × 40 mm, 709 × 472 px at 300 dpi", () => {
    expect([LABEL_MM.width, LABEL_MM.height, mmToPx(LABEL_MM.width), mmToPx(LABEL_MM.height)]).toEqual([60, 40, 709, 472]);
  });

  it("the issue day is the browser's calendar day; an unreadable one is empty", () => {
    const d = new Date(ISSUED_AT);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect([issueDay(ISSUED_AT), issueDay("not a date"), issueDay(null), issueDay(undefined)]).toEqual([expected, "", "", ""]);
  });

  it("the footer is the QR number and the issue day, either alone, or nothing", () => {
    expect([
      footerLine({ name: "x", qrNumber: "QR-1", issued: "2026-10-13" }),
      footerLine({ name: "x", qrNumber: null, issued: "2026-10-13" }),
      footerLine({ name: "x", qrNumber: "QR-1", issued: "" }),
      footerLine({ name: "x", qrNumber: null, issued: "" }),
    ]).toEqual(["QR QR-1 · 2026-10-13", "2026-10-13", "QR QR-1", ""]);
  });

  it("wrap: by words; a word wider than the column is cut; the last allowed line is ellipsised", () => {
    const { ctx } = recorder();
    expect(wrap(ctx, "Synthetic infusion pump", 100, 3)).toEqual(["Synthetic", "infusion", "pump"]);
    expect(wrap(ctx, "ab cd ef", 50, 3)).toEqual(["ab cd", "ef"]);
    expect(wrap(ctx, "abcdefghijklmnop", 50, 3)).toEqual(["abcde", "fghij", "klmnop".slice(0, 4) + "…"]);
    expect(wrap(ctx, "one two three four five six seven", 90, 2)).toEqual(["one two", "three…"]);
    expect(wrap(ctx, "", 90, 2)).toEqual([]);
  });

  it("drawLabel: paper over the whole label, every dark module inked inside the QR's square, nothing else there", () => {
    const { ctx, rects } = recorder();
    drawLabel(ctx, matrix, { name: "Synthetic infusion pump", qrNumber: "QR-000123", issued: "2026-10-13" }, COLOURS);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 709, h: 472, fill: "white" });
    const modules = rects.slice(1);
    let dark = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (darkAt(r, c)) dark++;
    expect(modules).toHaveLength(dark);
    expect(modules.every((m) => m.fill === "black" && m.w > 0 && m.h > 0)).toBe(true);
    const side = mmToPx(LABEL_MM.qr);
    const qx = mmToPx(LABEL_MM.pad);
    const qy = Math.round((472 - side) / 2);
    const unit = side / (SIZE + QR_MARGIN * 2);
    // Inside the square, clear of the quiet zone.
    expect(Math.min(...modules.map((m) => m.x))).toBeGreaterThanOrEqual(Math.floor(qx + QR_MARGIN * unit));
    expect(Math.max(...modules.map((m) => m.x + m.w))).toBeLessThanOrEqual(Math.ceil(qx + side - QR_MARGIN * unit));
    expect(Math.min(...modules.map((m) => m.y))).toBeGreaterThanOrEqual(Math.floor(qy + QR_MARGIN * unit));
    expect(Math.max(...modules.map((m) => m.y + m.h))).toBeLessThanOrEqual(Math.ceil(qy + side - QR_MARGIN * unit));
  });

  it("drawLabel: the bilingual caption, the name, the footer — right of the QR, inside the label; never the link", () => {
    const { ctx, texts } = recorder();
    // 10 px a character: the text column is 235 px (23 characters), so the long name wraps and is cut at three lines.
    drawLabel(ctx, matrix, { name: "Synthetic infusion pump with an unusually long registered name for the neonatal ward", qrNumber: "QR-000123", issued: "2026-10-13" }, COLOURS);
    const all = texts.map((t) => t.text).join(" | ");
    expect(all).toContain("Pindai");
    expect(all).toContain("Scan");
    expect(all).toContain("QR QR-000123 · 2026-10-13".slice(0, 12));
    expect(all).not.toContain(TOKEN);
    const nameLines = texts.filter((t) => /^\S*bold \d+px/.test(t.font) && t.font.startsWith(`bold ${mmToPx(3.2)}px`));
    expect(nameLines.length).toBe(3);
    expect(nameLines[2]?.text.endsWith("…")).toBe(true);
    const textX = mmToPx(LABEL_MM.pad) + mmToPx(LABEL_MM.qr) + mmToPx(LABEL_MM.gap);
    expect(texts.every((t) => t.x === textX && t.y >= 0 && t.y < 472)).toBe(true);
  });

  it("stickerPng: the label at 300 dpi from a canvas; null without a 2-D canvas or without a matrix", async () => {
    const { ctx } = recorder();
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const toUrl = jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(LABEL_PNG);
    const text = { name: "Synthetic infusion pump", qrNumber: null, issued: "2026-10-13" };
    expect(await stickerPng(URL_, text)).toBe(LABEL_PNG);
    expect(create).toHaveBeenCalledWith(URL_, { errorCorrectionLevel: "M" });
    expect(toUrl).toHaveBeenCalledWith("image/png");
    getContext.mockReturnValue(null);
    expect(await stickerPng(URL_, text)).toBeNull();
    create.mockImplementationOnce(() => {
      throw new Error("too long");
    });
    expect(await stickerPng(URL_, text)).toBeNull();
    getContext.mockRestore();
    toUrl.mockRestore();
  });
});

describe("P27-03 — the sticker in the dialog", () => {
  const renderDialog = (locale: "en" | "id" = "en") =>
    render(
      <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
        <PublicLinkDialog device={device()} onClose={jest.fn()} />
      </MessagesProvider>,
    );

  let getContext: jest.SpyInstance;
  let toUrl: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    get.mockImplementation((path: string) =>
      path === LINK
        ? Promise.resolve(ok({ active: false, issuedAt: null, issuedBy: null, lastRevokedAt: null, setting: "minimal" }))
        : Promise.reject(new Error(`unexpected GET ${path}`)),
    );
    post.mockImplementation((path: string) =>
      path === LINK ? Promise.resolve(ok({ token: TOKEN, url: URL_, issuedAt: ISSUED_AT })) : Promise.reject(new Error(`unexpected POST ${path}`)),
    );
    getContext = jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recorder().ctx as unknown as CanvasRenderingContext2D);
    toUrl = jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(LABEL_PNG);
  });
  afterEach(() => {
    getContext.mockRestore();
    toUrl.mockRestore();
  });

  it("the label: the QR, the bilingual caption, the name, QR number and issue day; the download is the label PNG", async () => {
    const { container } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Issue a link" }));
    const sticker = await screen.findByRole("region", { name: "Sticker" });
    const label = within(sticker).getByTestId("sticker-label");
    expect(label.className).toMatch(/\bw-\[60mm\]/);
    expect(label.className).toMatch(/\bh-\[40mm\]/);
    expect(label.className).toMatch(/\bbg-label-paper\b/);
    expect(within(label).getByRole("img", { name: "QR code of the public link of Synthetic infusion pump" })).toBeTruthy();
    expect(within(label).getByText(STICKER_CAPTION.id).getAttribute("lang")).toBe("id");
    expect(within(label).getByText(STICKER_CAPTION.en).getAttribute("lang")).toBe("en");
    expect(within(label).getByText("Synthetic infusion pump")).toBeTruthy();
    expect(within(label).getByText(`QR QR-000123 · ${issueDay(ISSUED_AT)}`)).toBeTruthy();
    expect(label.textContent).not.toContain(TOKEN);
    const download = await within(sticker).findByRole("link", { name: "Download the sticker (PNG)" });
    expect(download.getAttribute("href")).toBe(LABEL_PNG);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("without a canvas the download is the plain QR", async () => {
    getContext.mockReturnValue(null);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Issue a link" }));
    const download = await screen.findByRole("link", { name: "Download the sticker (PNG)" });
    expect(download.getAttribute("href")).toBe("data:image/png;base64,UVI=");
  });

  it("print lays the label alone under <body> in .sticker-print-root, and removes it after", async () => {
    const seen: Array<{ cls: boolean; roots: number; label: boolean; parentIsBody: boolean }> = [];
    const print = jest.spyOn(window, "print").mockImplementation(() => {
      const roots = document.querySelectorAll(".sticker-print-root");
      seen.push({
        cls: document.body.classList.contains(PRINT_CLASS),
        roots: roots.length,
        label: Boolean(roots[0]?.querySelector(".sticker-label")),
        parentIsBody: roots[0]?.parentElement === document.body,
      });
    });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Issue a link" }));
    fireEvent.click(await screen.findByRole("button", { name: "Print the sticker" }));
    expect(seen).toEqual([{ cls: true, roots: 1, label: true, parentIsBody: true }]);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".sticker-print-root")).toHaveLength(0);
    expect(document.body.classList.contains(PRINT_CLASS)).toBe(false);
    print.mockRestore();
  });

  it("the re-stickering policy: when to replace and when not to", async () => {
    renderDialog();
    expect(await screen.findByText("When to replace a sticker")).toBeTruthy();
    for (const line of [
      /damaged, unreadable or lost/,
      /moves to another room or facility/,
      /retired device/,
      /Deleting a device revokes its link/,
      /Remove the old sticker/,
      /only an old sticker gets a new one at its next visit/,
    ]) {
      expect(screen.getByText(line)).toBeTruthy();
    }
  });

  it("Indonesian: the policy in Indonesian; the label's caption is the same two languages", async () => {
    renderDialog("id");
    expect(await screen.findByText("Kapan stiker diganti")).toBeTruthy();
    expect(screen.getByText(/rusak, tidak terbaca atau hilang/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: idMessages["devices.publicLink.issue"] }));
    const label = await screen.findByTestId("sticker-label");
    expect(within(label).getByText(STICKER_CAPTION.id)).toBeTruthy();
    expect(within(label).getByText(STICKER_CAPTION.en)).toBeTruthy();
  });
});

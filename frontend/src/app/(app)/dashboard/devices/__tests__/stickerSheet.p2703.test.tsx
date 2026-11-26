/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { StickerSheet, putSticker, type SheetSticker } from "../components/StickerSheet";

const label = (n: number): SheetSticker => ({ deviceId: String(n), qr: "data:image/png;base64,UVI=", text: { name: `Pump ${String(n)}`, qrNumber: `QR${String(n)}`, issued: "2026-11-25" } });
const mount = (labels: SheetSticker[], remove = jest.fn(), clear = jest.fn()) => render(<MessagesProvider locale="en" messages={en}><StickerSheet labels={labels} onRemove={remove} onClear={clear} /></MessagesProvider>);

it("re-adding a device replaces its old label and preserves other devices", () => {
  const replaced = { ...label(1), qr: "data:image/png;base64,TkVX" };
  expect(putSticker([label(1), label(2)], replaced)).toEqual([label(2), replaced]);
});

it("an empty tray has no controls; populated tray names removal and clear actions and is axe-clean", async () => {
  const empty = mount([]);
  expect(screen.queryByRole("region")).toBeNull();
  empty.unmount();
  const remove = jest.fn(); const clear = jest.fn();
  const { container } = mount([label(1), label(2)], remove, clear);
  expect(screen.getByRole("heading", { name: "Sticker sheet (2)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove sticker of Pump 1" }));
  expect(remove).toHaveBeenCalledWith("1");
  fireEvent.click(screen.getByRole("button", { name: "Clear sticker sheet" }));
  expect(clear).toHaveBeenCalledTimes(1);
  expect(await axeViolations(container)).toEqual([]);
});

it("prints 19 labels as 18+1 on separate sheet roots and cleans the portal afterwards", () => {
  const saved = jest.spyOn(Storage.prototype, "setItem");
  const print = jest.spyOn(window, "print").mockImplementation(() => {
    expect(document.body.classList.contains("sticker-sheet-print")).toBe(true);
    const root = document.querySelector(".sticker-sheet-print-root");
    expect(root?.parentElement).toBe(document.body);
    const pages = [...(root?.querySelectorAll(".sticker-sheet-page") ?? [])];
    expect(pages.map((page) => page.querySelectorAll(".sticker-label").length)).toEqual([18, 1]);
    expect(root?.textContent).not.toContain("data:image");
  });
  mount(Array.from({ length: 19 }, (_, i) => label(i)));
  fireEvent.click(screen.getByRole("button", { name: "Print A4 sticker sheets" }));
  expect(print).toHaveBeenCalledTimes(1);
  expect(document.body.classList.contains("sticker-sheet-print")).toBe(false);
  expect(document.querySelector(".sticker-sheet-print-root")).toBeNull();
  expect(saved).not.toHaveBeenCalled();
  print.mockRestore(); saved.mockRestore();
});

/** @jest-environment jsdom */
/**
 * U-06b (ADR-120): the dashboard's "updated at" line — the backend serves the
 * figures from a cache of up to 30 s, so the page says when they were computed,
 * in Indonesian or English after the `locale` cookie.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import DashboardUpdatedAt, { formatClock, readLocaleCookie } from "./DashboardUpdatedAt";

const AT = "2030-01-15T09:04:05.000Z";
const local = (iso: string): string => {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
};

const setCookie = (value: string | null): void => {
  document.cookie = value === null ? "locale=; max-age=0" : `locale=${value}`;
};

afterEach(() => setCookie(null));

describe("DashboardUpdatedAt", () => {
  it("reads the locale cookie: id, en, and the default (id) for absent or unknown", () => {
    expect(readLocaleCookie("a=1; locale=en; b=2")).toBe("en");
    expect(readLocaleCookie("locale=id")).toBe("id");
    expect(readLocaleCookie("")).toBe("id");
    expect(readLocaleCookie("locale=fr")).toBe("id");
  });

  it("formats HH:MM:SS in local time, 24-hour, and refuses an unreadable timestamp", () => {
    expect(formatClock(AT)).toBe(local(AT));
    expect(formatClock(AT)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatClock("not a date")).toBeNull();
  });

  it("says 'Diperbarui pukul' in Indonesian, marked lang=id", () => {
    setCookie("id");
    render(<DashboardUpdatedAt generatedAt={AT} />);
    const line = screen.getByText(/Diperbarui pukul/);
    expect(line).toHaveAttribute("lang", "id");
    expect(screen.getByText(local(AT))).toHaveAttribute("dateTime", AT);
  });

  it("says 'Updated at' in English, marked lang=en", () => {
    setCookie("en");
    render(<DashboardUpdatedAt generatedAt={AT} />);
    expect(screen.getByText(/Updated at/)).toHaveAttribute("lang", "en");
    expect(screen.getByText(local(AT)).tagName).toBe("TIME");
  });

  it("renders nothing for an unreadable timestamp", () => {
    const { container } = render(<DashboardUpdatedAt generatedAt="garbage" />);
    expect(container).toBeEmptyDOMElement();
  });
});

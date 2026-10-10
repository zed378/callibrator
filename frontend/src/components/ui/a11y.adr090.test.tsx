/**
 * ADR-090 / F-12 browser sweep — the fixes the axe sweep over every route
 * (headless Chrome, light and dark) called for, pinned in the component suite.
 *
 * Fail-before (HEAD a31c601 + batch 8): the theme tokens failed 4.5:1 as text
 * on their own tints (slate-500 on slate-100 was 4.34:1; the status colours on
 * their /10 tints 2.6–4.5:1; dark primary under white 3.7:1) — 509 of the 513
 * WCAG failures the sweep found were colour contrast; Pagination's page-size
 * <select> had no name and its « » buttons read as punctuation; a Table column
 * with an empty header rendered an empty <th>; Alert's dismiss button and the
 * row actions of DevicesTable and TenantCard were icon-only with no name;
 * the password toggle on sign-in had no name. And once a visual <label> is
 * associated with a ui/Select by htmlFor, the label replaced the trigger's
 * content as its name, so the selected value was no longer announced.
 *
 * jsdom has no layout, so contrast is checked here from the token values in
 * globals.css against the ADR-090 thresholds, not by axe.
 */
import fs from "fs";
import path from "path";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { Pagination } from "./Table/Pagination";
import { Table } from "./Table/Table";
import { Alert } from "./Alert";
import { Card, CardHeader } from "./Card";
import { Select } from "./Select";
import { PasswordLoginForm } from "@/app/(public)/login/components/PasswordLoginForm";
import { DeviceTable } from "@/app/(app)/dashboard/devices/components/DeviceTable";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { TenantCard } from "@/app/(app)/dashboard/tenants/components/TenantCard";
import type { Tenant } from "@/types";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/dashboard",
}));

// ---------------------------------------------------------------------------
// Contrast: the tokens themselves.
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

const hex = (h: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${h}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (c: Rgb): number => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb): number => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** A Tailwind `bg-x/NN` tint composited over `under`. */
const tint = (c: Rgb, under: Rgb, alpha: number): Rgb =>
  c.map((v, i) => Math.round(v * alpha + under[i] * (1 - alpha))) as Rgb;

const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
/** The theme block for a selector: the top-level one that defines `--background`. */
const block = (selector: string): Record<string, string> => {
  const re = new RegExp(`^${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "gm");
  for (const m of css.matchAll(re)) {
    if (!m[1].includes("--background:")) continue;
    const out: Record<string, string> = {};
    for (const t of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[t[1]] = t[2];
    return out;
  }
  throw new Error(`no ${selector} theme block in globals.css`);
};

// ADR-122: `neutral` (the grey draft / inactive status) joins the rule.
const STATUS = ["primary", "destructive", "success", "warning", "info", "accent", "neutral"] as const;
const AA = 4.5;

describe("ADR-090: theme tokens meet WCAG 2.1 AA 1.4.3", () => {
  const light = block(":root");
  const dark = block(".dark");

  it.each([
    ["light", light, ["background", "card", "muted", "surface-hover", "surface-selected", "sidebar"]],
    ["dark", dark, ["background", "card", "muted", "surface-hover", "surface-selected", "sidebar"]],
  ] as const)("%s: muted-foreground is 4.5:1 on every surface", (_t, tokens, surfaces) => {
    for (const s of surfaces) {
      expect(ratio(hex(tokens["muted-foreground"]), hex(tokens[s]))).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(STATUS)("light: %s reads at 4.5:1 as text on the page, the card and its own /10 and /15 tint", (name) => {
    const c = hex(light[name]);
    for (const s of ["background", "card"]) {
      const under = hex(light[s]);
      expect(ratio(c, under)).toBeGreaterThanOrEqual(AA);
      expect(ratio(c, tint(c, under, 0.1))).toBeGreaterThanOrEqual(AA);
      expect(ratio(c, tint(c, under, 0.15))).toBeGreaterThanOrEqual(AA);
    }
    expect(ratio(hex(light[`${name}-foreground`]), c)).toBeGreaterThanOrEqual(AA);
  });

  it.each(STATUS)("dark: %s reads at 4.5:1 as text on the page, the card and its own /10 tint", (name) => {
    const c = hex(dark[name]);
    for (const s of ["background", "card"]) {
      const under = hex(dark[s]);
      expect(ratio(c, under)).toBeGreaterThanOrEqual(AA);
      expect(ratio(c, tint(c, under, 0.1))).toBeGreaterThanOrEqual(AA);
    }
    expect(ratio(hex(dark[`${name}-foreground`]), c)).toBeGreaterThanOrEqual(AA);
  });
});

/**
 * ADR-122 (P11-01): the pairs the warm palette adds (spec P11-00 §7.3 item 5).
 * Each is read from globals.css, so a value change cannot drift from the
 * ADR's table. Fail-before (the slate tokens): --input equalled --border and
 * was 1.23:1 on the light card and 1.41:1 on the dark one (spec D4); there
 * was no hover/pressed fill, no neutral, no sidebar and no chart series.
 */
describe("ADR-122: warm palette pairs (WCAG 1.4.3, 1.4.11)", () => {
  const themes = [
    ["light", block(":root")],
    ["dark", block(".dark")],
  ] as const;
  const UI = 3;

  it.each(themes)("%s: control boundaries (--input, --border-strong) are 3:1 on page, card, muted and popover", (_t, tk) => {
    for (const name of ["input", "border-strong"]) {
      for (const s of ["background", "card", "muted", "popover"]) {
        expect(ratio(hex(tk[name]), hex(tk[s]))).toBeGreaterThanOrEqual(UI);
      }
    }
  });

  it.each(themes)("%s: the focus ring (= primary) is 3:1 on page, card, muted, popover, selected and sidebar", (_t, tk) => {
    expect(css).toMatch(/--ring: var\(--primary\);/);
    for (const s of ["background", "card", "muted", "popover", "surface-selected", "sidebar"]) {
      expect(ratio(hex(tk.primary), hex(tk[s]))).toBeGreaterThanOrEqual(UI);
    }
  });

  it.each(themes)("%s: primary reads at 4.5:1 as text on the selected item, hover and the sidebar", (_t, tk) => {
    for (const s of ["surface-selected", "surface-hover", "sidebar"]) {
      expect(ratio(hex(tk.primary), hex(tk[s]))).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(themes)("%s: text tokens are 4.5:1 on hover, selected, sidebar, popover and secondary", (_t, tk) => {
    for (const t of ["foreground", "muted-foreground", "popover-foreground", "card-foreground"]) {
      for (const s of ["surface-hover", "surface-selected", "sidebar", "popover", "secondary", "muted"]) {
        expect(ratio(hex(tk[t]), hex(tk[s]))).toBeGreaterThanOrEqual(AA);
      }
    }
    expect(ratio(hex(tk["secondary-foreground"]), hex(tk.secondary))).toBeGreaterThanOrEqual(AA);
  });

  it.each(themes)("%s: the primary, hover and pressed fills carry their text at 4.5:1", (_t, tk) => {
    for (const fill of ["primary", "primary-hover", "primary-pressed"]) {
      expect(ratio(hex(tk["primary-foreground"]), hex(tk[fill]))).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(themes)("%s: every chart series is 3:1 on the card and the page", (_t, tk) => {
    for (const n of [1, 2, 3, 4, 5]) {
      for (const s of ["background", "card"]) {
        expect(ratio(hex(tk[`chart-${n}`]), hex(tk[s]))).toBeGreaterThanOrEqual(UI);
      }
    }
  });

  it.each(themes)("%s: a draft (transparent) status badge reads at 4.5:1 on every surface it sits on", (_t, tk) => {
    for (const s of ["background", "card", "muted", "popover", "surface-hover", "surface-selected"]) {
      expect(ratio(hex(tk.neutral), hex(tk[s]))).toBeGreaterThanOrEqual(AA);
    }
  });

  // Spec D5 — fail-before: the kanban priority hexes were 1.48–3.76:1 on white.
  it.each(themes)("%s: the priority ramp is 3:1 on card, page and muted, strongest for urgent", (_t, tk) => {
    const steps = ["urgent", "high", "medium", "low"].map((p) => hex(tk[`priority-${p}`]));
    for (const s of ["background", "card", "muted"]) {
      for (const c of [...steps, hex(tk["priority-none"])]) {
        expect(ratio(c, hex(tk[s]))).toBeGreaterThanOrEqual(UI);
      }
      const onCard = steps.map((c) => ratio(c, hex(tk.card)));
      expect([...onCard].sort((a, b) => b - a)).toEqual(onCard); // monotone: urgent strongest
    }
  });

  it("ink on the scrim (photo controls) is 3:1 even over a white photograph, both themes", () => {
    for (const [sel] of [[":root"], [".dark"]]) {
      const body = new RegExp(`^${sel.replace(".", "\\.")} \\{([^}]*)\\}`, "m");
      const blocks = [...css.matchAll(new RegExp(body.source, "gm"))].map((m) => m[1]).find((b) => b.includes("--scrim:"));
      expect(blocks).toBeDefined();
      const m = /--scrim:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(blocks as string);
      const fg = /--scrim-foreground:\s*(#[0-9a-fA-F]{6})/.exec(blocks as string);
      expect(m && fg).toBeTruthy();
      const [r, g, b, a] = (m as RegExpExecArray).slice(1).map(Number);
      const overWhite = tint([r, g, b] as Rgb, [255, 255, 255], a);
      expect(ratio(hex((fg as RegExpExecArray)[1]), overWhite)).toBeGreaterThanOrEqual(UI);
    }
  });

  it("the five chart series are five distinct colours in each theme", () => {
    for (const [, tk] of themes) {
      const series = [1, 2, 3, 4, 5].map((n) => tk[`chart-${n}`].toLowerCase());
      expect(new Set(series).size).toBe(5);
    }
  });

  it("the status aliases point at the five status tokens, in both themes", () => {
    for (const [alias, token] of [
      ["current", "success"],
      ["attention", "warning"],
      ["alarm", "destructive"],
      ["draft", "neutral"],
      ["info", "info"],
    ]) {
      expect(css).toContain(`--status-${alias}: var(--${token});`);
      expect(css).toContain(`--status-${alias}-foreground: var(--${token}-foreground);`);
    }
  });
});

// ---------------------------------------------------------------------------
// Names, roles and structure.
// ---------------------------------------------------------------------------

describe("Pagination (ADR-090 sweep)", () => {
  it("names the page-size select and the four page buttons, and is axe-clean", async () => {
    const onPage = jest.fn();
    const { container } = render(
      <Pagination
        currentPage={2}
        totalPages={5}
        totalItems={50}
        pageSize={10}
        onPageChange={onPage}
        onPageSizeChange={() => {}}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
    for (const name of ["First page", "Previous page", "Next page", "Last page"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(3);
    // The "/" is decorative (aria-hidden); a screen reader hears "Page 2 of 5".
    const current = container.querySelector('[aria-live="polite"]');
    expect(current).not.toBeNull();
    const spokenCopy = (current as Element).cloneNode(true) as Element;
    spokenCopy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    expect(spokenCopy.textContent?.replace(/\s+/g, " ").trim()).toBe("Page 2 of 5");
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Select (ADR-090 sweep)", () => {
  it("a label associated by htmlFor names the trigger without hiding its value", async () => {
    const { container } = render(
      <>
        <label htmlFor="status-field">Status</label>
        <Select
          id="status-field"
          value="a"
          onChange={() => {}}
          options={[
            { value: "a", label: "Active" },
            { value: "b", label: "Retired" },
          ]}
        />
      </>,
    );
    expect(screen.getByRole("button", { name: "Status Active" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Table (ADR-090 sweep)", () => {
  // P11-07: found by the 360 px sweep (automate/p11.browser.mts) on
  // /dashboard/calibration — fail-before: the scroll wrapper had no tabindex.
  it("its sideways-scrolling wrapper is keyboard-reachable even with no control in a cell", async () => {
    const { container } = render(<Table columns={[{ key: "name", header: "Name" }]} data={[{ name: "Row" }]} />);
    expect(container.querySelector(".overflow-x-auto")).toHaveAttribute("tabindex", "0");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an empty header still names its column", async () => {
    const { container } = render(
      <Table
        columns={[
          { key: "name", header: "Name" },
          { key: "actions", header: "" },
        ]}
        data={[{ name: "Row", actions: "x" }]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Alert and CardHeader (ADR-090 sweep)", () => {
  it("Alert: the dismiss button has a name and the title is not a heading", async () => {
    const onClose = jest.fn();
    const { container } = render(
      <Alert variant="error" title="Error" onClose={onClose}>
        Something failed
      </Alert>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("CardHeader: a string title is a level-2 heading (dashboard pages have one h1)", () => {
    render(
      <Card>
        <CardHeader title="Plan & Usage" />
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Plan & Usage" })).toBeInTheDocument();
  });
});

describe("Icon-only controls carry a name (ADR-090 sweep)", () => {
  it("sign-in: the password visibility toggle is named and reports its state", async () => {
    const setShow = jest.fn();
    const { container } = render(
      <PasswordLoginForm
        username="ada"
        password=""
        setPassword={() => {}}
        onSubmit={(e) => e.preventDefault()}
        // P10-04: the password step now follows an identifier step.
        onChangeAccount={() => {}}
        isLoading={false}
        showPassword={false}
        setShowPassword={setShow}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(setShow).toHaveBeenCalledWith(true);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("DeviceTable (P22-02): every row action is named after the device", async () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const device = {
      id: "d1",
      tenantId: "t1",
      name: "Fluke 5522A",
      serialNumber: null,
      manufacturer: null,
      model: null,
      category: null,
      status: "active" as const,
      locationId: null,
      installationDate: null,
      nextCalibrationDate: null,
      calibrationIntervalDays: null,
      remarks: null,
      iotEnabled: false,
      isDeleted: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const { container } = render(
      <MessagesProvider locale="en" messages={en}>
        <DeviceTable
          rows={[device]}
          showFacility
          actions={{ photos: true, ipm: true, edit: true, remove: true, iot: true }}
          onPhotos={() => {}}
          onEdit={onEdit}
          onDelete={onDelete}
          onIot={() => {}}
        />
      </MessagesProvider>,
    );
    expect(screen.getByRole("button", { name: "Photos of Fluke 5522A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "IoT ingest for Fluke 5522A" })).toBeInTheDocument();
    // P22-04 (F-57): the device's IPM history is a link to the history narrowed to it.
    expect(screen.getByRole("link", { name: "IPM history of Fluke 5522A" })).toHaveAttribute("href", "/dashboard/ipm?deviceId=d1");
    fireEvent.click(screen.getByRole("button", { name: "Edit Fluke 5522A" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Fluke 5522A" }));
    expect(onEdit).toHaveBeenCalledWith(device);
    expect(onDelete).toHaveBeenCalledWith(device);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("TenantCard: every action is named after the tenant and the name is a heading", async () => {
    const tenant = {
      id: "t1",
      name: "Alpha Clinic",
      code: "ALPHA",
      status: "active",
      limitSeats: 10,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    } as unknown as Tenant;
    const { container } = render(
      <TenantCard
        tenant={tenant}
        onEdit={() => {}}
        onSsoConfig={() => {}}
        onMfaPolicy={() => {}}
        onDelete={() => {}}
        canManageBackups /* ADR-102: backups are offered only to a management writer */
      />,
    );
    const actions = within(container);
    for (const name of [
      "Manage backups for Alpha Clinic",
      "Configure SAML SSO for Alpha Clinic",
      "MFA policy for Alpha Clinic",
      "Edit Alpha Clinic",
      "Delete Alpha Clinic",
    ]) {
      expect(actions.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 2, name: "Alpha Clinic" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

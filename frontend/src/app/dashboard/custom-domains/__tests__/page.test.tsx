/** @jest-environment jsdom */
/**
 * Custom domains page against the backend contract
 * (backend/src/routes/api/customDomains.route.js, mounted
 * /api/v1/custom-domains; controllers/customDomains.controller.js;
 * services/customDomains.service.js; models/customDomain.model.ts):
 *  - GET  /domains → CustomDomain rows in `data` ({ domain, domainType,
 *    status: pending_verification | active | verification_failed, isDefault,
 *    sslEnabled, … });
 *  - POST /domains { domain, type, sslEnabled } → 201; 409 when it is taken;
 *  - GET  /domains/:id/dns → { verification: TXT, cname: CNAME, instructions }
 *    — an object, not a list;
 *  - POST /domains/:id/verify (409 for a removed domain) · /default;
 *  - DELETE /domains/:id.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import CustomDomainsPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown, message = "ok", status = 200) => ({ success: true, status, message, data });

/** A CustomDomain row as the model serialises it. */
const domainRow = (
  id: string,
  domain: string,
  status: "pending_verification" | "active" | "verification_failed",
  extra: Record<string, unknown> = {},
) => ({
  id,
  tenantId: "t-1",
  domain,
  domainType: "custom",
  status,
  isDefault: false,
  sslEnabled: true,
  verificationToken: "callibrator-verify=abc",
  verifiedAt: status === "active" ? "2026-09-10T00:00:00.000Z" : null,
  lastCheckedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

let domains: unknown[];

const dnsAnswer = {
  verification: { type: "TXT", name: "_domain_verify.clinic.example.com", value: "callibrator-verify=abc" },
  cname: { type: "CNAME", name: "clinic.example.com", value: "cname.callibrator.io." },
  instructions: ["1. Add the TXT record to verify domain ownership"],
};

const backend = () => {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/custom-domains/domains") return ok(domains, "Custom domains retrieved");
    if (url === "/api/v1/custom-domains/domains/d-1/dns") return ok(dnsAnswer, "DNS records generated");
    throw httpError(404, "Domain not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));
const writeText = jest.fn();

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ "custom-domains": "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  domains = [
    domainRow("d-1", "clinic.example.com", "pending_verification"),
    domainRow("d-2", "portal.example.com", "active", { isDefault: true, domainType: "subdomain", sslEnabled: false }),
    domainRow("d-3", "old.example.com", "verification_failed"),
  ];
  backend();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

const renderLoaded = async () => {
  const view = render(<CustomDomainsPage />);
  await screen.findByText("clinic.example.com");
  return view;
};

const rowOf = (domain: string) => screen.getByText(domain).closest("tr") as HTMLElement;

describe("custom domains — reading", () => {
  it("lists each domain with its type, SSL, default flag and status", async () => {
    const { container } = await renderLoaded();

    expect(within(rowOf("clinic.example.com")).getByText("custom · SSL on")).toBeInTheDocument();
    expect(within(rowOf("portal.example.com")).getByText("subdomain · SSL off")).toBeInTheDocument();
    expect(within(rowOf("portal.example.com")).getByText("default")).toBeInTheDocument();
    // The default domain offers no "Make default".
    expect(within(rowOf("portal.example.com")).queryByRole("button", { name: "Make default" })).not.toBeInTheDocument();
    expect(within(rowOf("clinic.example.com")).getByRole("button", { name: "Make default" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("colours a live domain as success, a pending one as a warning and a failed one as danger", async () => {
    await renderLoaded();

    // ADR-122 (P11-05): tones from lib/statusTone.ts (shape + icon + colour).
    expect(within(rowOf("portal.example.com")).getByText("active")).toHaveAttribute("data-tone", "current");
    expect(within(rowOf("clinic.example.com")).getByText("pending_verification")).toHaveAttribute("data-tone", "attention");
    expect(within(rowOf("old.example.com")).getByText("verification_failed")).toHaveAttribute("data-tone", "alarm");
  });

  it("no domains is the empty state", async () => {
    domains = [];
    render(<CustomDomainsPage />);

    expect(await screen.findByText("No custom domains configured.")).toBeInTheDocument();
  });

  it("a refused read (403) shows the error", async () => {
    mockedGet.mockRejectedValue(httpError(403, "You do not have permission to read custom domains"));
    const { container } = render(<CustomDomainsPage />);

    expect(await screen.findByText("You do not have permission to read custom domains")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("custom domains — adding", () => {
  const openAdd = () => {
    fireEvent.click(screen.getByRole("button", { name: "Add Domain" }));
    return screen.getByRole("dialog", { name: "Add Custom Domain" });
  };

  it("refuses a URL or path instead of a bare hostname", async () => {
    await renderLoaded();
    const dialog = openAdd();

    fireEvent.change(within(dialog).getByLabelText(/Hostname/), { target: { value: "https://clinic.example.com/x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Domain" }));

    expect(toasts()).toContainEqual({
      type: "error",
      title: "Invalid hostname",
      description: "Use a bare hostname like clinic.example.com — no scheme or path.",
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("POSTs the lower-cased hostname, type and SSL choice, then closes", async () => {
    mockedPost.mockResolvedValue(ok(domainRow("d-9", "lab.example.com", "pending_verification"), "Custom domain added", 201));
    const { container } = await renderLoaded();
    const dialog = openAdd();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Hostname/), { target: { value: "  Lab.Example.COM " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Type/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "vanity" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Provision SSL/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Domain" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/custom-domains/domains", {
      domain: "lab.example.com",
      type: "vanity",
      sslEnabled: false,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({
      type: "success",
      title: "Domain added — add the DNS records to verify it",
      description: undefined,
    });
  });

  it("a domain another organisation holds (409) explains why and keeps the form", async () => {
    const taken =
      "This domain is already registered and verified by an organisation on this platform. It can be added here once that registration is removed.";
    mockedPost.mockRejectedValue(httpError(409, taken));
    await renderLoaded();
    const dialog = openAdd();

    fireEvent.change(within(dialog).getByLabelText(/Hostname/), { target: { value: "taken.example.com" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Domain" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Action failed", description: taken });
    expect(screen.getByRole("dialog", { name: "Add Custom Domain" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Hostname/)).toHaveValue("taken.example.com");
  });
});

describe("custom domains — DNS, verify, default", () => {
  it("shows the TXT and CNAME records the backend generates, and copies them", async () => {
    const { container } = await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "DNS" }));
    });

    const dialog = screen.getByRole("dialog", { name: "DNS records — clinic.example.com" });
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/custom-domains/domains/d-1/dns");
    expect(within(dialog).getByText("TXT")).toBeInTheDocument();
    expect(within(dialog).getByText("_domain_verify.clinic.example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("CNAME")).toBeInTheDocument();
    expect(within(dialog).getByText("cname.callibrator.io.")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await act(async () => {
      fireEvent.click(within(dialog).getAllByRole("button", { name: "Copy value" })[0]);
    });
    expect(writeText).toHaveBeenCalledWith("callibrator-verify=abc");
    expect(toasts()).toContainEqual({ type: "success", title: "Copied", description: undefined });

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a DNS read that fails (404) says so, with no records", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("old.example.com")).getByRole("button", { name: "DNS" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Could not load DNS records", description: "Domain not found" });
    expect(screen.getByText("No records returned.")).toBeInTheDocument();
  });

  it("a failed copy says so", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await renderLoaded();
    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "DNS" }));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Copy name" })[1]);
    });

    expect(writeText).toHaveBeenCalledWith("clinic.example.com");
    expect(toasts()).toContainEqual({ type: "error", title: "Copy failed", description: undefined });
  });

  it("Verify POSTs /verify; a removed domain's 409 is explained", async () => {
    const removed = "This domain was removed and cannot be verified. Add it again to start a new verification.";
    mockedPost.mockRejectedValueOnce(httpError(409, removed)).mockResolvedValueOnce(ok({ verified: false }));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "Verify" }));
    });
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/custom-domains/domains/d-1/verify");
    expect(toasts()).toContainEqual({ type: "error", title: "Action failed", description: removed });

    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "Verify" }));
    });
    // A 200 with verified:false is NOT a success (F-19).
    expect(toasts().map((t) => t.title)).not.toContain("Verification started");
    expect(toasts()).toContainEqual(expect.objectContaining({ type: "warning", title: "Domain not verified" }));
  });

  it("F-19: a check that finds the TXT record reports the domain verified and reloads", async () => {
    mockedPost.mockResolvedValueOnce(
      ok(
        {
          verified: true,
          status: "active",
          record: "callibrator-verify=abc",
          dnsRecord: { type: "CNAME", name: "_domain_verify.clinic.example.com", value: "callibrator-verify=abc" },
        },
        "Domain verification initiated",
      ),
    );
    await renderLoaded();
    const reads = mockedGet.mock.calls.length;

    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "Verify" }));
    });

    expect(toasts()).toEqual([
      { type: "success", title: "Domain verified", description: "clinic.example.com is now active." },
    ]);
    expect(mockedGet.mock.calls.length).toBe(reads + 1);
  });

  it("F-19: a check that does not find the record says so and tells the user what to do", async () => {
    // The backend's real body for a failed DNS lookup — still a 200.
    mockedPost.mockResolvedValueOnce(
      ok(
        {
          verified: false,
          status: "verification_failed",
          record: null,
          dnsRecord: { type: "CNAME", name: "_domain_verify.clinic.example.com", value: "callibrator-verify=abc" },
        },
        "Domain verification initiated",
      ),
    );
    await renderLoaded();
    const reads = mockedGet.mock.calls.length;

    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "Verify" }));
    });

    const shown = toasts();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ type: "warning", title: "Domain not verified" });
    expect(shown[0].description).toContain("_domain_verify.clinic.example.com");
    expect(shown[0].description).toMatch(/propagat/);
    // The row's new status (verification_failed) is read back.
    expect(mockedGet.mock.calls.length).toBe(reads + 1);
  });

  it("F-19: custom domains switched off — the backend's reason is shown, not a success", async () => {
    mockedPost.mockResolvedValueOnce(ok({ verified: false, reason: "Custom domains disabled" }));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "Verify" }));
    });

    expect(toasts()).toEqual([
      { type: "warning", title: "Domain not verified", description: "Custom domains disabled" },
    ]);
  });

  it("Make default POSTs /default and reloads", async () => {
    mockedPost.mockResolvedValue(ok(domainRow("d-1", "clinic.example.com", "active", { isDefault: true })));
    await renderLoaded();
    const reads = mockedGet.mock.calls.length;

    await act(async () => {
      fireEvent.click(within(rowOf("clinic.example.com")).getByRole("button", { name: "Make default" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/custom-domains/domains/d-1/default");
    expect(mockedGet.mock.calls.length).toBe(reads + 1);
    expect(toasts()).toContainEqual({ type: "success", title: "Default domain set", description: undefined });
  });
});

describe("custom domains — removing (destructive, confirmed)", () => {
  it("asks first; Cancel sends nothing", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove clinic.example.com" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Domain" });
    expect(within(dialog).getByText(/stop serving the platform immediately/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("confirming DELETEs it and reloads the list", async () => {
    mockedDelete.mockImplementation(async () => {
      domains = domains.slice(1);
      return ok(null, "Custom domain removed");
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove clinic.example.com" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("clinic.example.com")).not.toBeInTheDocument());
    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/custom-domains/domains/d-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a refused removal keeps the confirmation open", async () => {
    mockedDelete.mockRejectedValue(httpError(403, "You do not have permission to write custom domains"));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove clinic.example.com" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    });

    expect(toasts()).toContainEqual({
      type: "error",
      title: "Action failed",
      description: "You do not have permission to write custom domains",
    });
    expect(screen.getByRole("dialog", { name: "Remove Domain" })).toBeInTheDocument();
  });
});

/**
 * ADR-102 — custom domains writes are gated on `custom-domains` write. HEALTHCARE ADMIN holds `custom-domains` read; the DNS records (a read) stay.
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: Add, Verify, Make default and Remove rendered for every role (audit 01 §4.8).
 */
describe("ADR-102 — custom domains write controls follow the effective permission", () => {
  const writeControls = [
      /Add Domain/,
      /^Verify$/,
      /Make default/,
      /^Remove /,
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "custom-domains": "read" });
    render(<CustomDomainsPage />);
    await screen.findByText("clinic.example.com");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<CustomDomainsPage />);
    await screen.findByText("clinic.example.com");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<CustomDomainsPage />);
    await screen.findByText("clinic.example.com");
    expect(screen.getAllByRole("button", { name: /Add Domain/ }).length).toBeGreaterThan(0);
  });
});

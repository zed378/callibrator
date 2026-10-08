/**
 * ADR-090 amendment — the tenant brand colour on the page and on the form.
 *
 * Fail-before: applyBrandColor wrote the raw colour into `--primary` for both
 * themes; the tenant form gave no hint that a colour would be unreadable.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { applyBrandColor } from "@/components/TenantBrandingProvider";
import { BrandColorPreview, TenantFormFields } from "../TenantFormFields";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/hooks/useTenantBranding", () => ({
  useTenantBranding: () => ({ branding: null }),
}));

const style = () => document.documentElement.style;

describe("applyBrandColor (ADR-090 amendment)", () => {
  afterEach(() => applyBrandColor(null));

  it("sets an accessible pair per theme and never the raw colour", () => {
    applyBrandColor("#ffff00");
    const root = document.documentElement;
    expect(root.hasAttribute("data-tenant-brand")).toBe(true);
    // Yellow is unreadable on white, so the light shade is a darker yellow...
    expect(style().getPropertyValue("--brand-primary-light")).not.toBe("#ffff00");
    // ...and it is already fine on the dark card.
    expect(style().getPropertyValue("--brand-primary-dark")).toBe("#ffff00");
    expect(style().getPropertyValue("--brand-primary-foreground-dark")).toBe("#0f172a");
    expect(style().getPropertyValue("--primary")).toBe("");
    expect(style().getPropertyValue("--primary-foreground")).toBe("");
  });

  it("clears everything for no colour or an invalid one", () => {
    applyBrandColor("#1e3a8a");
    applyBrandColor("not-a-colour");
    expect(document.documentElement.hasAttribute("data-tenant-brand")).toBe(false);
    expect(style().getPropertyValue("--brand-primary-light")).toBe("");
    expect(style().getPropertyValue("--brand-primary-dark")).toBe("");
  });

  it("removes a raw --primary an earlier build left on <html>", () => {
    style().setProperty("--primary", "#ffff00");
    applyBrandColor("#1d4ed8");
    expect(style().getPropertyValue("--primary")).toBe("");
  });
});

describe("the tenant form's brand colour preview", () => {
  it("shows the shade each theme will use and says when it was adjusted", () => {
    render(<BrandColorPreview value="#ffff00" />);
    const list = screen.getByRole("list", { name: "Brand color as rendered" });
    expect(list).toHaveTextContent(/Light theme: #[0-9a-f]{6} \(adjusted for contrast\)/);
    expect(list).toHaveTextContent("Dark theme: #ffff00 (as chosen)");
  });

  it("renders nothing until the value is a #RRGGBB colour", () => {
    const { container } = render(<BrandColorPreview value="#ff" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels the colour text field and is axe-clean", async () => {
    const form = {
      name: "Acme", code: "ACME", description: "", primaryColor: "#ef4444", limitSeats: "10",
      email: "", phone: "", address: "", city: "", state: "", zipCode: "", country: "", website: "",
    };
    const { container } = render(<TenantFormFields form={form} setForm={() => {}} />);
    expect(screen.getByLabelText("Brand Color")).toHaveValue("#ef4444");
    expect(screen.getByTestId("brand-color-preview")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

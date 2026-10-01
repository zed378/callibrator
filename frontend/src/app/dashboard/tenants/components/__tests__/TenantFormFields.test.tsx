/** @jest-environment jsdom */
/**
 * The tenant form fields (name, code, brand colour, seats, contact, address)
 * and the address block, each rendered with a real parent state.
 */
import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { TenantFormFields, BrandColorPreview } from "../TenantFormFields";
import { TenantAddressFields } from "../TenantAddressFields";
import { initialCreateForm } from "../../hooks/useTenants";

type Form = typeof initialCreateForm;

function Harness({ showBasicOnly, onForm }: { showBasicOnly?: boolean; onForm: (f: Form) => void }) {
  const [form, setForm] = useState<Form>({ ...initialCreateForm });
  onForm(form);
  return (
    <form aria-label="Tenant">
      <TenantFormFields form={form} setForm={setForm} showBasicOnly={showBasicOnly} />
    </form>
  );
}

describe("TenantFormFields", () => {
  it("writes every field into the form and passes an accessibility check", async () => {
    let latest = initialCreateForm;
    const { container } = render(<Harness onForm={(f) => (latest = f)} />);

    const fields: Array<[string, keyof Form, string]> = [
      ["Name", "name", "RS Baru"],
      ["Code", "code", "RSB"],
      ["Description", "description", "New wing"],
      ["Seat limit", "limitSeats", "25"],
      ["Email", "email", "it@rsb.test"],
      ["Phone", "phone", "+62 2"],
      ["Address", "address", "Jl. Baru"],
      ["City", "city", "Jakarta"],
      ["State", "state", "DKI"],
      ["Zip Code", "zipCode", "10110"],
      ["Country", "country", "Indonesia"],
      ["Website", "website", "https://rsb.test"],
    ];
    for (const [label, , value] of fields) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    for (const [, key, value] of fields) expect(latest[key]).toBe(value);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the colour picker and the hex box edit the same brand colour", () => {
    let latest = initialCreateForm;
    render(<Harness onForm={(f) => (latest = f)} />);

    fireEvent.change(screen.getByLabelText("Brand color picker"), { target: { value: "#112233" } });
    expect(latest.primaryColor).toBe("#112233");
    expect(screen.getByLabelText("Brand Color")).toHaveValue("#112233");

    // A value that is not #rrggbb yet (mid-typing) leaves the picker on the default.
    fireEvent.change(screen.getByLabelText("Brand Color"), { target: { value: "#12" } });
    expect(latest.primaryColor).toBe("#12");
    expect(screen.getByLabelText("Brand color picker")).toHaveValue("#4f46e5");
  });

  it("the basic variant leaves out city, state, zip, country and website", () => {
    render(<Harness showBasicOnly onForm={() => undefined} />);

    expect(screen.getByLabelText("Address")).toBeInTheDocument();
    expect(screen.queryByLabelText("City")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Website")).not.toBeInTheDocument();
  });
});

describe("BrandColorPreview", () => {
  it("shows how the colour renders in each theme", () => {
    render(<BrandColorPreview value="#4f46e5" />);
    const list = screen.getByRole("list", { name: "Brand color as rendered" });

    expect(within(list).getByText(/Light theme:/)).toBeInTheDocument();
    expect(within(list).getByText(/Dark theme:/)).toBeInTheDocument();
  });

  it("shows nothing for a value that is not a colour", () => {
    const { container } = render(<BrandColorPreview value="not-a-colour" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TenantAddressFields", () => {
  it("reports each field by its key", () => {
    const update = jest.fn();
    render(
      <TenantAddressFields
        form={{ phone: "", address: "", city: "", state: "", zipCode: "", country: "", website: "" }}
        update={update}
      />,
    );

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Zip Code"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "7" } });

    expect(update.mock.calls).toEqual([
      ["phone", "1"],
      ["address", "2"],
      ["city", "3"],
      ["state", "4"],
      ["zipCode", "5"],
      ["country", "6"],
      ["website", "7"],
    ]);
  });
});

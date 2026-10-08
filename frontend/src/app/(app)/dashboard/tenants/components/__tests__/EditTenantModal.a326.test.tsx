/**
 * A-326 / ADR-112 — the tenant edit never changes the status. The modal shows
 * the status read-only (no select), and offers the super admin the lifecycle
 * actions instead: suspend (a reason is required) or resume. A tenant admin
 * sees the status and no action.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditTenantModal, type TenantFormState } from "../EditTenantModal";
import type { Tenant } from "@/types";

const form: TenantFormState = {
  name: "RS A", code: "RSA", description: "", primaryColor: "#112233", status: "active",
  email: "", phone: "", address: "", city: "", state: "", zipCode: "", country: "", website: "",
};

const renderModal = (status: string, props: Partial<React.ComponentProps<typeof EditTenantModal>> = {}) => {
  const onLifecycle = jest.fn();
  render(
    <EditTenantModal
      isOpen
      tenant={{ id: "t1", name: "RS A", code: "RSA", status } as unknown as Tenant}
      onClose={jest.fn()}
      form={{ ...form, status }}
      onChange={jest.fn()}
      error=""
      isSubmitting={false}
      logoFile={null}
      setLogoFile={jest.fn()}
      logoPreview=""
      setLogoPreview={jest.fn()}
      logoKeep={false}
      setLogoKeep={jest.fn()}
      onSubmit={jest.fn()}
      platformFieldsEditable
      onLifecycle={onLifecycle}
      {...props}
    />,
  );
  return onLifecycle;
};

describe("EditTenantModal — status (A-326 / ADR-112)", () => {
  it("shows the status read-only: there is no status select", () => {
    renderModal("active");
    expect(screen.getByTestId("tenant-status")).toHaveTextContent("Active");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Select status")).toBeNull();
  });

  it("an active tenant: Suspend needs a reason, then calls the lifecycle action with it", () => {
    const onLifecycle = renderModal("active");
    const suspend = screen.getByRole("button", { name: "Suspend tenant" });
    expect(suspend).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for suspension"), { target: { value: "  Contract ended " } });
    expect(suspend).toBeEnabled();
    fireEvent.click(suspend);
    expect(onLifecycle).toHaveBeenCalledWith("suspend", "Contract ended");
    expect(screen.queryByRole("button", { name: "Resume tenant" })).toBeNull();
  });

  it("a suspended tenant: Resume calls the lifecycle action", () => {
    const onLifecycle = renderModal("suspended");
    expect(screen.getByTestId("tenant-status")).toHaveTextContent("Suspended");
    fireEvent.click(screen.getByRole("button", { name: "Resume tenant" }));
    expect(onLifecycle).toHaveBeenCalledWith("resume");
    expect(screen.queryByRole("button", { name: "Suspend tenant" })).toBeNull();
  });

  it("a tenant admin sees the status and no lifecycle action", () => {
    const onLifecycle = renderModal("active", { platformFieldsEditable: false });
    expect(screen.getByTestId("tenant-status")).toHaveTextContent("Active");
    expect(screen.queryByRole("button", { name: /Suspend|Resume/ })).toBeNull();
    expect(onLifecycle).not.toHaveBeenCalled();
  });
});

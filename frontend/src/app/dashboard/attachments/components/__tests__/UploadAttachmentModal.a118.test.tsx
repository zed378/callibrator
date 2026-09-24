/** @jest-environment jsdom */
/**
 * A-118 — the upload modal offered "General / Unlinked" with a record-id field.
 *
 * Since A-97 the backend refuses a record id for any type that is not linkable
 * (attachment.service LINKABLE_RESOURCES) with a 400, so a user who chose
 * "General" and filled the field got an error for doing what the form asked.
 * The field is now shown only for a linkable type, and switching back to
 * General clears an id typed earlier — so it cannot ride along unseen.
 *
 * Fail-before: the field was always rendered, and the id survived the switch.
 */
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  UploadAttachmentModal,
  isLinkableResourceType,
  LINKABLE_RESOURCE_TYPES,
} from "../UploadAttachmentModal";
import type { AttachmentFormState } from "../../hooks/useAttachments";

const Harness: React.FC<{ initial?: AttachmentFormState }> = ({
  initial = { resourceType: "generic", resourceId: "" },
}) => {
  const [form, setForm] = useState<AttachmentFormState>(initial);
  return (
    <>
      {/* The form state the modal wrote, for the assertions. */}
      <output data-testid="form-state">{JSON.stringify(form)}</output>
      <UploadAttachmentModal
        isOpen
        onClose={jest.fn()}
        isLoading={false}
        form={form}
        setForm={setForm}
        file={null}
        setFile={jest.fn()}
        onSubmit={jest.fn()}
      />
    </>
  );
};

const formState = (): AttachmentFormState =>
  JSON.parse(screen.getByTestId("form-state").textContent || "null");

const choose = (current: string, label: string) => {
  fireEvent.click(screen.getByRole("button", { name: current }));
  fireEvent.click(screen.getByRole("option", { name: label }));
};

describe("A-118 — the record id is offered only for a linkable type", () => {
  it("General / Unlinked shows no record-id field, and says why", () => {
    render(<Harness />);

    expect(screen.queryByLabelText(/linked record id/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not linked to a record/i)).toBeInTheDocument();
  });

  it.each([
    ["Device"],
    ["Certificate"],
    ["Work Order"],
    ["Calibration Record"],
  ])("%s shows the record-id field", (label) => {
    render(<Harness />);

    choose("General / Unlinked", label);

    expect(screen.getByLabelText(/linked record id/i)).toBeInTheDocument();
  });

  it("switching back to General clears an id typed for a linkable type", () => {
    render(<Harness />);
    choose("General / Unlinked", "Device");
    fireEvent.change(screen.getByLabelText(/linked record id/i), {
      target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    expect(formState()).toEqual({
      resourceType: "device",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    choose("Device", "General / Unlinked");

    expect(formState()).toEqual({ resourceType: "generic", resourceId: "" });
    expect(screen.queryByLabelText(/linked record id/i)).not.toBeInTheDocument();
  });

  it("switching between linkable types keeps the id", () => {
    render(<Harness initial={{ resourceType: "device", resourceId: "x-1" }} />);

    choose("Device", "Certificate");

    expect(formState()).toEqual({ resourceType: "certificate", resourceId: "x-1" });
  });

  it("the linkable set is the backend's frontend-facing keys (attachment.service LINKABLE_RESOURCES)", () => {
    expect([...LINKABLE_RESOURCE_TYPES].sort()).toEqual(
      ["calibration", "certificate", "device", "workorder"],
    );
    expect(isLinkableResourceType(" Device ")).toBe(true);
    expect(isLinkableResourceType("generic")).toBe(false);
    expect(isLinkableResourceType("post")).toBe(false);
  });
});

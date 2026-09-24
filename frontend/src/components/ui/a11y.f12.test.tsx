/**
 * F-12 — the shared form and dialog primitives, checked by axe-core and by
 * the associations a screen reader relies on.
 *
 * Fail-before: Input/Textarea/FormField rendered a <label> with no htmlFor
 * and a control with no id, and no aria-invalid / aria-describedby anywhere;
 * Dialog had no role, no name, no Escape, no focus handling, and an icon-only
 * close button with no name. axe reported `label` and `button-name`.
 */
import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { FormField } from "./FormField";
import { Select } from "./Select";
import { Dialog } from "./Dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import AccessDeniedModal from "@/components/AccessDeniedModal";
import { axeViolations } from "@/tests/a11y/axe";

describe("form primitives (F-12)", () => {
  it("Input: the label names the control; an error marks it invalid and describes it", async () => {
    const { container } = render(<Input label="Serial number" error="Required" />);
    const input = screen.getByLabelText("Serial number");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Required");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Input: helper text describes the control when there is no error; a caller's id wins", async () => {
    render(<Input id="sn" label="Serial" helperText="As printed on the plate" />);
    const input = screen.getByLabelText("Serial");
    expect(input).toHaveAttribute("id", "sn");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("As printed on the plate");
  });

  it("Input: the password toggle has a name that says what it does", () => {
    render(<Input label="Password" type="password" />);
    const toggle = screen.getByRole("button", { name: "Show password" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  });

  it("Textarea: label, invalid state and message are associated", async () => {
    const { container } = render(<Textarea label="Notes" error="Too long" />);
    const ta = screen.getByLabelText("Notes");
    expect(ta).toHaveAttribute("aria-invalid", "true");
    expect(ta).toHaveAccessibleDescription("Too long");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("FormField: labels its single child control and ties the error to it", async () => {
    const { container } = render(
      <FormField label="Device name" error="Required" required>
        <input type="text" />
      </FormField>,
    );
    const input = screen.getByLabelText(/Device name/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAccessibleDescription("Required");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("FormField: labels a ui/Select's trigger", () => {
    render(
      <FormField label="Status" helperText="Pick one">
        <Select value="" onChange={() => {}} options={[{ value: "a", label: "A" }]} />
      </FormField>,
    );
    const trigger = screen.getByRole("button", { name: /Status/ });
    expect(trigger).toHaveAccessibleDescription("Pick one");
  });

  it("FormField: with several children it labels nothing rather than the wrong one", () => {
    render(
      <FormField label="Range">
        <input aria-label="from" />
        <input aria-label="to" />
      </FormField>,
    );
    expect(screen.getByText("Range")).not.toHaveAttribute("for");
  });
});

function Harness({ withTitle = true }: { withTitle?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title={withTitle ? "Edit device" : undefined}
        ariaLabel={withTitle ? undefined : "Edit device"}
      >
        <input aria-label="Name" />
        <button>Save</button>
      </Dialog>
    </>
  );
}

describe("Dialog (F-12)", () => {
  it("is a named modal dialog with a named close button, and passes axe", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    const dialog = screen.getByRole("dialog", { name: "Edit device" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("moves focus in, traps Tab, closes on Escape and returns focus to the opener", () => {
    render(<Harness />);
    const opener = screen.getByText("Open");
    opener.focus();
    fireEvent.click(opener);

    const close = screen.getByRole("button", { name: "Close dialog" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(close).toHaveFocus();

    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("with no visible title it is named by ariaLabel", () => {
    render(<Harness withTitle={false} />);
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByRole("dialog", { name: "Edit device" })).toBeInTheDocument();
  });

  it("a ConfirmDialog is named by its title", async () => {
    const { container } = render(
      <ConfirmDialog isOpen title="Delete device?" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: "Delete device?" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("AccessDeniedModal is a named alert dialog carrying the backend's reason, closable by Escape", async () => {
    const onClose = jest.fn();
    const { container } = render(
      <AccessDeniedModal
        isOpen
        userName="Ada"
        message="You may not delete devices"
        onClose={onClose}
        onRedirectToProfile={() => {}}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Access Restricted" });
    expect(dialog).toHaveAccessibleDescription(/You may not delete devices/);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

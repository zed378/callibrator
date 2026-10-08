/** @jest-environment jsdom */
/**
 * P10-16 (ADR-099) — the first-password form: labelled fields that password
 * managers treat as a NEW password, the rule stated before typing, a mismatch
 * announced, errors in an alert region, and a submit that stays disabled until
 * the rule and the confirmation are met.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FirstPasswordChangeForm, meetsPasswordRule } from "../FirstPasswordChangeForm";
import { en } from "@/i18n/messages/en";

/** The backend's rule as the form states it (English: no provider in this test). */
const PASSWORD_RULE = en["auth.first.rule"];

const renderForm = (patch: Partial<React.ComponentProps<typeof FirstPasswordChangeForm>> = {}) => {
  const props = {
    newPassword: "",
    setNewPassword: jest.fn(),
    confirmPassword: "",
    setConfirmPassword: jest.fn(),
    onSubmit: jest.fn((e: React.FormEvent) => e.preventDefault()),
    onBack: jest.fn(),
    isLoading: false,
    error: null,
    ...patch,
  };
  render(<FirstPasswordChangeForm {...props} />);
  return props;
};

describe("FirstPasswordChangeForm", () => {
  it("both fields are labelled and autocomplete=new-password", () => {
    renderForm();
    const first = screen.getByLabelText("New password");
    const confirm = screen.getByLabelText("Confirm new password");
    expect(first).toHaveAttribute("autocomplete", "new-password");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");
    expect(first).toHaveAttribute("type", "password");
    expect(first).toHaveAttribute("aria-describedby", "first-password-rule");
    expect(screen.getByText(PASSWORD_RULE)).toBeInTheDocument();
  });

  it("disables submit until the rule and the confirmation are met", () => {
    renderForm({ newPassword: "weak", confirmPassword: "weak" });
    expect(screen.getByRole("button", { name: /save password/i })).toBeDisabled();
  });

  it("announces a mismatch on the confirmation field", () => {
    renderForm({ newPassword: "Chosen-Pass-42", confirmPassword: "Chosen-Pass-41" });
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save password/i })).toBeDisabled();
  });

  it("submits when the rule and the confirmation are met", () => {
    const props = renderForm({ newPassword: "Chosen-Pass-42", confirmPassword: "Chosen-Pass-42" });
    const button = screen.getByRole("button", { name: /save password/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it("shows an error in an alert region", () => {
    renderForm({ error: "This step has expired." });
    expect(screen.getByRole("alert")).toHaveTextContent("This step has expired.");
  });

  it("shows progress while saving and offers a way back", () => {
    const props = renderForm({ isLoading: true, newPassword: "Chosen-Pass-42", confirmPassword: "Chosen-Pass-42" });
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("forwards typing to the setters", () => {
    const props = renderForm();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "b" } });
    expect(props.setNewPassword).toHaveBeenCalledWith("a");
    expect(props.setConfirmPassword).toHaveBeenCalledWith("b");
  });
});

describe("meetsPasswordRule mirrors the backend rule", () => {
  it.each([
    ["Chosen-Pass-42", true],
    ["short1A", false],
    ["alllowercase1", false],
    ["ALLUPPERCASE1", false],
    ["NoDigitsHere", false],
    [`Aa1${"x".repeat(98)}`, false],
  ])("%s → %s", (value, expected) => {
    expect(meetsPasswordRule(value)).toBe(expected);
  });
});

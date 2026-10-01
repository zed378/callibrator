/** @jest-environment jsdom */
/**
 * The stand-alone create-user form and the username availability line. Each
 * is rendered on its own with a real parent state, so what is asserted is what
 * the user sees and what reaches the handlers.
 */
import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { CreateUserForm } from "../CreateUserForm";
import { UsernameAvailability } from "../UsernameAvailability";

const blank = { username: "", firstName: "", lastName: "", email: "", password: "", roleId: "", tenantId: "" };
const rules = { minLength: true, hasUppercase: false, hasLowercase: true, hasNumber: false, hasSymbol: false };

function Harness(props: {
  formError?: string;
  availability?: { checking: boolean; available: boolean | null };
  onSubmit?: (form: typeof blank) => void;
  check?: jest.Mock;
  validate?: jest.Mock;
}) {
  const [form, setForm] = useState({ ...blank });
  return (
    <CreateUserForm
      createForm={form}
      setCreateForm={setForm}
      formError={props.formError ?? ""}
      isSubmitting={false}
      passwordValidation={rules}
      usernameAvailability={props.availability ?? { checking: false, available: null }}
      checkUsernameAvailability={props.check ?? jest.fn()}
      validatePassword={props.validate ?? jest.fn()}
      roleOptions={[{ value: "r-1", label: "Technician" }]}
      tenantOptions={[{ value: "t-1", label: "RS Harapan" }]}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit?.(form);
      }}
    />
  );
}

describe("CreateUserForm", () => {
  it("collects every field, checks the username and password as typed, and submits them", () => {
    const check = jest.fn();
    const validate = jest.fn();
    const onSubmit = jest.fn();
    render(<Harness check={check} validate={validate} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Alan" } });
    fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Turing" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alan" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alan@x.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Str0ng!Pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Select role" }));
    fireEvent.click(screen.getByRole("option", { name: "Technician" }));
    fireEvent.click(screen.getByRole("button", { name: "Select tenant" }));
    fireEvent.click(screen.getByRole("option", { name: "RS Harapan" }));

    expect(check).toHaveBeenLastCalledWith("alan");
    expect(validate).toHaveBeenLastCalledWith("Str0ng!Pass");
    // The checklist appears once a password is typed.
    expect(screen.getByText(/uppercase/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create User" }));
    expect(onSubmit).toHaveBeenCalledWith({
      firstName: "Alan",
      lastName: "Turing",
      username: "alan",
      email: "alan@x.test",
      password: "Str0ng!Pass",
      roleId: "r-1",
      tenantId: "t-1",
    });
  });

  it("shows the form error and passes an accessibility check", async () => {
    const { container } = render(<Harness formError="Email already registered" />);

    expect(screen.getByText("Email already registered")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    [{ checking: true, available: null }, "Checking availability..."],
    [{ checking: false, available: false }, "Username is already taken"],
    [{ checking: false, available: true }, "Username is available"],
  ])("reports the username check %j as %s", (availability, text) => {
    render(<Harness availability={availability} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alan" } });
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe("UsernameAvailability", () => {
  it.each([
    [{ checking: true, available: null, username: "al" }, "Checking availability..."],
    [{ checking: false, available: false, username: "alan" }, "Username is already taken"],
    [{ checking: false, available: true, username: "alan" }, "Username is available"],
    [{ checking: false, available: true, username: "alan", isCurrentUsername: true }, "This is your current username"],
    [{ checking: false, available: null, username: "" }, "Enter a username to check availability"],
    [{ checking: false, available: null, username: "al" }, "Username must be at least 3 characters"],
  ])("%j reads %s", (props, text) => {
    render(<UsernameAvailability {...props} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("says nothing while a 3+ character name awaits its check", () => {
    const { container } = render(<UsernameAvailability checking={false} available={null} username="alan" />);
    expect(container).toBeEmptyDOMElement();
  });
});

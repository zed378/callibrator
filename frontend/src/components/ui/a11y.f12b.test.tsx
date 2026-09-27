/**
 * F-12 (remainder) — DateField, MultiSelect and SearchableDropdown, the three
 * primitives the card's Definition of Done names that a11y.f12 did not cover.
 *
 * Fail-before (HEAD): DateField rendered a <label> with no htmlFor, a control
 * with no id and no aria-invalid / aria-describedby; MultiSelect's trigger was
 * a clickable <div> — not focusable, not nameable, no listbox, no option
 * roles, and each chip's remove button had no name (axe `button-name`);
 * SearchableDropdown nested its clear <button> inside the trigger <button>
 * and put role="listbox" on a wrapper that also held the search box.
 */
import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DateField } from "./DateField";
import { FormField } from "./FormField";
import { MultiSelect } from "./MultiSelect";
import { SearchableDropdown } from "./SearchableDropdown";
import { axeViolations } from "@/tests/a11y/axe";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

describe("DateField (F-12)", () => {
  it("DateField: the label names the control; an error marks it invalid and describes it", async () => {
    const { container } = render(
      <DateField label="Due date" error="Required" value="" onChange={() => {}} />,
    );
    const input = screen.getByLabelText("Due date");
    expect(input).toHaveAttribute("type", "date");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Required");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("DateField: helper text describes it when there is no error", () => {
    render(<DateField label="Due date" helperText="Local time" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Due date");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("Local time");
  });

  it("DateField inside a FormField: the field's label and error reach the date input", async () => {
    const { container } = render(
      <FormField label="Audit Schedule Date" error="Pick a date" required>
        <DateField value="" onChange={() => {}} />
      </FormField>,
    );
    const input = screen.getByLabelText(/Audit Schedule Date/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Pick a date");
    expect(await axeViolations(container)).toEqual([]);
  });
});

function Categories({ initial = [] as string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <div>
      <label htmlFor="cats">Categories</label>
      <MultiSelect id="cats" options={OPTIONS} value={value} onChange={setValue} />
      <output data-testid="value">{value.join(",")}</output>
    </div>
  );
}

describe("MultiSelect (F-12)", () => {
  it("MultiSelect: the trigger is a button named by its label, and passes axe closed", async () => {
    const { container } = render(<Categories />);
    const trigger = screen.getByLabelText("Categories");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("MultiSelect: open, it is a named multi-select listbox of options, and passes axe", async () => {
    const { container } = render(<Categories initial={["b"]} />);
    fireEvent.click(screen.getByLabelText("Categories"));

    expect(screen.getByLabelText("Categories")).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("MultiSelect: the keyboard alone opens it, picks with the arrows and Enter, and Escape returns focus", () => {
    render(<Categories />);
    const trigger = screen.getByLabelText("Categories");
    trigger.focus();
    fireEvent.click(trigger); // Enter/Space on a <button> is a click.

    const search = screen.getByRole("textbox", { name: "Search options" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Bravo" }).id,
    );
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByTestId("value")).toHaveTextContent("b");

    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("MultiSelect: each chip's remove button says what it removes and never submits a form", () => {
    const onSubmit = jest.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Categories initial={["a", "c"]} />
      </form>,
    );
    const remove = screen.getByRole("button", { name: "Remove Alpha" });
    expect(remove).toHaveAttribute("type", "button");
    fireEvent.click(remove);
    expect(screen.getByTestId("value")).toHaveTextContent("c");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("SearchableDropdown (F-12)", () => {
  function Device({ initial = "" }) {
    const [value, setValue] = useState(initial);
    return (
      <div>
        <label htmlFor="dev">Device</label>
        <SearchableDropdown id="dev" options={OPTIONS} value={value} onChange={setValue} allowClear />
      </div>
    );
  }

  it("SearchableDropdown: named by its label; open, the listbox is the list itself and passes axe", async () => {
    const { container } = render(<Device />);
    const trigger = screen.getByLabelText("Device");
    expect(trigger.tagName).toBe("BUTTON");
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    expect(listbox.tagName).toBe("UL");
    expect(within(listbox).queryByRole("textbox")).toBeNull();
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: "Search options" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("SearchableDropdown: the clear control is a named button beside the trigger, not inside it", async () => {
    const { container } = render(<Device initial="a" />);
    const clear = screen.getByRole("button", { name: "Clear selection" });
    expect(screen.getByLabelText("Device")).not.toContainElement(clear);
    expect(await axeViolations(container)).toEqual([]);
  });
});

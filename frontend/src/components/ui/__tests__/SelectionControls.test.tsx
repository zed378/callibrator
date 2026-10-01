/** @jest-environment jsdom */
/**
 * SearchableDropdown and MultiSelect behaviour beyond the F-12 a11y checks
 * (a11y.f12b.test.tsx): filtering, keyboard selection with wrap-around,
 * clearing, closing, disabled state, and custom option rendering.
 */
import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { SearchableDropdown } from "../SearchableDropdown";
import { MultiSelect } from "../MultiSelect";

const OPTIONS = [
  { value: "pump", label: "Infusion Pump" },
  { value: "ecg", label: "ECG Monitor" },
  { value: "vent", label: "Ventilator" },
];

function Single(props: Partial<React.ComponentProps<typeof SearchableDropdown>> & { initial?: string }) {
  const { initial = "", ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <div>
      <p>outside</p>
      <p data-testid="value">{value || "(none)"}</p>
      <SearchableDropdown aria-label="Device" options={OPTIONS} value={value} onChange={setValue} {...rest} />
    </div>
  );
}

function Multi(props: Partial<React.ComponentProps<typeof MultiSelect>> & { initial?: string[] }) {
  const { initial = [], ...rest } = props;
  const [value, setValue] = useState<string[]>(initial);
  return (
    <div>
      <p>outside</p>
      <p data-testid="value">{value.join(",") || "(none)"}</p>
      <MultiSelect aria-label="Devices" options={OPTIONS} value={value} onChange={setValue} {...rest} />
    </div>
  );
}

const shown = () => screen.getByTestId("value").textContent;

describe("SearchableDropdown", () => {
  it("filters by the typed term, case-insensitively, and picks by click", async () => {
    const { container } = render(<Single />);
    fireEvent.click(screen.getByRole("button", { name: "Device" }));

    const search = screen.getByRole("textbox", { name: "Search options" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "MON" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ECG Monitor"]);
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("option", { name: "ECG Monitor" }));
    expect(shown()).toBe("ecg");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("no match says so", () => {
    render(<Single emptyMessage="No devices." />);
    fireEvent.click(screen.getByRole("button", { name: "Device" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search options" }), { target: { value: "zzz" } });

    expect(screen.getByRole("status")).toHaveTextContent("No devices.");
  });

  it("the keyboard opens it, moves with wrap-around, and Enter picks", () => {
    render(<Single />);
    const trigger = screen.getByRole("button", { name: "Device" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const search = screen.getByRole("textbox", { name: "Search options" });

    fireEvent.keyDown(search, { key: "ArrowUp" }); // wraps to the last
    expect(search.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Ventilator" }).id);
    fireEvent.keyDown(search, { key: "ArrowDown" }); // wraps to the first
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(shown()).toBe("ecg");
  });

  it("Enter with nothing highlighted keeps it open; Escape closes without choosing", () => {
    render(<Single />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Device" }), { key: "Enter" });
    const search = screen.getByRole("textbox", { name: "Search options" });

    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(shown()).toBe("(none)");
  });

  it("an option can be picked from the keyboard on the option itself", () => {
    render(<Single />);
    fireEvent.click(screen.getByRole("button", { name: "Device" }));

    fireEvent.keyDown(screen.getByRole("option", { name: "Ventilator" }), { key: " " });

    expect(shown()).toBe("vent");
  });

  it("a click outside closes it", () => {
    render(<Single />);
    fireEvent.click(screen.getByRole("button", { name: "Device" }));

    fireEvent.mouseDown(screen.getByText("outside"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows the chosen option, and clears it by button or by Delete when clearing is allowed", () => {
    render(<Single initial="pump" allowClear />);
    expect(screen.getByRole("button", { name: "Device" })).toHaveTextContent("Infusion Pump");

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(shown()).toBe("(none)");
    expect(screen.queryByRole("button", { name: "Clear selection" })).not.toBeInTheDocument();
  });

  // A-302 fail-before: handleClear dispatched a click on the trigger, so
  // clearing (by the button or by Delete) OPENED the list.
  it("clearing leaves the list closed and focus on the trigger (A-302)", () => {
    render(<Single initial="pump" allowClear />);

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Device" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Device" })).toHaveFocus();
  });

  it("clearing an open list by Delete closes it (A-302)", () => {
    render(<Single initial="ecg" allowClear />);
    fireEvent.click(screen.getByRole("button", { name: "Device" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: "Device" }), { key: "Delete" });

    expect(shown()).toBe("(none)");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Delete on the trigger clears", () => {
    render(<Single initial="ecg" allowClear />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Device" }), { key: "Delete" });

    expect(shown()).toBe("(none)");
  });

  it("without allowClear there is no clear control and Delete does nothing", () => {
    render(<Single initial="ecg" />);

    expect(screen.queryByRole("button", { name: "Clear selection" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Device" }), { key: "Backspace" });
    expect(shown()).toBe("ecg");
  });

  it("disabled, it does not open", () => {
    render(<Single disabled initial="ecg" allowClear />);

    fireEvent.click(screen.getByRole("button", { name: "Device" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Device" }), { key: "Enter" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear selection" })).not.toBeInTheDocument();
  });

  it("renders options and the selection with a custom renderer", () => {
    render(<Single initial="vent" renderOption={(o) => <em>{o.label.toUpperCase()}</em>} />);

    expect(screen.getByRole("button", { name: "Device" })).toHaveTextContent("VENTILATOR");
    fireEvent.click(screen.getByRole("button", { name: "Device" }));
    expect(within(screen.getByRole("listbox")).getByText("ECG MONITOR")).toBeInTheDocument();
  });
});

describe("MultiSelect", () => {
  it("toggles options on and off, and shows each choice as a removable chip", async () => {
    const { container } = render(<Multi />);
    fireEvent.click(screen.getByRole("button", { name: "Devices" }));

    fireEvent.click(screen.getByRole("option", { name: "Infusion Pump" }));
    fireEvent.click(screen.getByRole("option", { name: "Ventilator" }));
    expect(shown()).toBe("pump,vent");
    expect(screen.getByRole("option", { name: "Ventilator" })).toHaveAttribute("aria-selected", "true");
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("option", { name: "Infusion Pump" }));
    expect(shown()).toBe("vent");

    fireEvent.click(screen.getByRole("button", { name: "Remove Ventilator" }));
    expect(shown()).toBe("(none)");
  });

  it("filters by the typed term, and says when nothing matches", () => {
    render(<Multi emptyMessage="No categories yet." />);
    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    const search = screen.getByRole("textbox", { name: "Search options" });

    fireEvent.change(search, { target: { value: "vent" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ventilator"]);
    fireEvent.change(search, { target: { value: "xyz" } });
    expect(screen.getByRole("status")).toHaveTextContent("No categories yet.");
    // Arrows over an empty list highlight nothing.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(search).not.toHaveAttribute("aria-activedescendant");
  });

  it("ArrowUp from the top wraps to the last option; Enter toggles it", () => {
    render(<Multi />);
    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    const search = screen.getByRole("textbox", { name: "Search options" });

    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(shown()).toBe("vent");
  });

  it("the chip area opens it; a click outside and Escape on the trigger close it", () => {
    render(<Multi initial={["ecg"]} />);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("ECG Monitor").closest("div.flex") as HTMLElement);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Devices" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("disabled, it does not open", () => {
    render(<Multi disabled initial={["ecg"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    fireEvent.click(screen.getByText("ECG Monitor").closest("div.flex") as HTMLElement);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

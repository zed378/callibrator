/**
 * P6-02 (ADR-077) — a cell given as JSX in `data` renders as that element.
 *
 * The table used to `String()` every cell without a `render`, so every screen
 * that builds cells as JSX (DevicesTable among them) showed "[object Object]".
 * Found by the browser smoke (automate/smoke.browser.js) on the live stack.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { Table, renderCell } from "../Table";

describe("P6-02: Table cells", () => {
  it("renders a JSX cell as the element, never as [object Object]", () => {
    render(
      <Table
        columns={[
          { key: "name", header: "Name" },
          { key: "model", header: "Model" },
          { key: "count", header: "Count" },
          { key: "missing", header: "Missing" },
        ]}
        data={[{ name: <strong>Fluke 87V</strong>, model: "DM-100", count: 3 }]}
      />,
    );

    expect(screen.getByText("Fluke 87V").tagName).toBe("STRONG");
    expect(screen.getByText("DM-100")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  it("renderCell: elements and node arrays pass through; everything else is text", () => {
    const el = <em>x</em>;
    expect(renderCell(el)).toBe(el);
    const nodes = [<b key="a">a</b>, "b"];
    expect(renderCell(nodes)).toBe(nodes);
    expect(renderCell(0)).toBe("0");
    expect(renderCell(false)).toBe("false");
    expect(renderCell(null)).toBe("");
    expect(renderCell(undefined)).toBe("");
  });

  it("a column's own render still wins", () => {
    render(
      <Table
        columns={[{ key: "v", header: "V", render: (v) => <span>rendered {String(v)}</span> }]}
        data={[{ v: 7 }]}
      />,
    );
    expect(screen.getByText("rendered 7")).toBeInTheDocument();
  });
});

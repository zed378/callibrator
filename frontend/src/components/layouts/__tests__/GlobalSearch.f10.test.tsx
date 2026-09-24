/**
 * F-10 — the global search box exists only for a principal who can search.
 *
 * Fail-before: TopBar rendered <GlobalSearch /> for every role, and a 403 from
 * /search was shown as red text after every two keystrokes.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockSearch = jest.fn();
jest.mock("@/api/services/search.service", () => {
  const actual = jest.requireActual("@/api/services/search.service");
  return { ...actual, searchService: { search: (...a: unknown[]) => mockSearch(...a) } };
});

import GlobalSearch from "../GlobalSearch";
import { useMenuStore } from "@/stores/menuStore";
import type { MenuGroup } from "@/types";
import { menuHasAnyPath, SEARCHABLE_MENU_PATHS } from "@/lib/menuAccess";

const group = (path: string, items: MenuGroup["items"] = []): MenuGroup => ({
  label: path,
  icon: "x",
  path,
  items,
});

const withMenu = (groups: MenuGroup[]) =>
  useMenuStore.setState({ menuGroups: groups, searchRefused: false });

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
});
afterEach(() => jest.useRealTimers());

describe("GlobalSearch (F-10)", () => {
  it("all three searchable menus → the box renders", () => {
    withMenu([
      group("/dashboard/devices"),
      group("/dashboard/warehouses"),
      group("/dashboard/calibration"),
    ]);
    render(<GlobalSearch />);
    expect(screen.getByLabelText("Global search")).toBeInTheDocument();
  });

  it("one searchable menu, nested in a group → the box renders", () => {
    withMenu([
      group("/dashboard/inventory", [
        { label: "Warehouses", icon: "w", path: "/dashboard/warehouses" },
      ]),
    ]);
    render(<GlobalSearch />);
    expect(screen.getByLabelText("Global search")).toBeInTheDocument();
  });

  it("none of the three → no box, and no request can be sent", () => {
    withMenu([group("/dashboard/maintenance"), group("/dashboard/finance")]);
    const { container } = render(<GlobalSearch />);
    expect(container).toBeEmptyDOMElement();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("a 403 from /search removes the box instead of showing an error", async () => {
    withMenu([group("/dashboard/devices")]);
    mockSearch.mockRejectedValue(
      new AxiosError("Forbidden", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 403,
        statusText: "Forbidden",
        data: { message: "Forbidden" },
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    const { container } = render(<GlobalSearch />);

    fireEvent.change(screen.getByLabelText("Global search"), { target: { value: "pump" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(useMenuStore.getState().searchRefused).toBe(true);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Forbidden/)).toBeNull();
  });

  it("menuHasAnyPath walks every depth", () => {
    expect(menuHasAnyPath([], SEARCHABLE_MENU_PATHS)).toBe(false);
    expect(
      menuHasAnyPath([{ items: [{ items: [{ path: "/dashboard/calibration" }] }] }], SEARCHABLE_MENU_PATHS),
    ).toBe(true);
  });
});

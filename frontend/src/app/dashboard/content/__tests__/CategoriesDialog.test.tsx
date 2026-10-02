/** @jest-environment jsdom */
/**
 * Managing CMS categories against /api/v1/content/categories
 * (content.controller.ts: list rows in `data`; POST/PATCH answer the category;
 * DELETE answers `data: null`; an unknown id is 404 "Category not found").
 * Real: the dialog and the content service. Mocked: the transport.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import CategoriesDialog from "../components/CategoriesDialog";
import { useToastStore } from "@/stores/toastStore";
import { httpError } from "@/tests/support/httpErrors";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

let rows: Array<{ id: string; name: string; slug: string }> = [];
const ok = (data: unknown) => ({ success: true, status: 200, message: "ok", data, meta: null });

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  rows = [{ id: "c1", name: "Compliance", slug: "compliance" }];
  mockedGet.mockImplementation(async () => ok(rows));
});

const open = async (onChanged = jest.fn(), onClose = jest.fn()) => {
  const view = render(<CategoriesDialog isOpen onClose={onClose} onChanged={onChanged} />);
  await screen.findByText("Compliance");
  return { ...view, onChanged, onClose };
};

const errorToast = (title: string) =>
  waitFor(() =>
    expect(useToastStore.getState().toasts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "error", title })]),
    ),
  );

describe("CategoriesDialog", () => {
  it("lists the categories with their slugs when opened", async () => {
    const { container } = await open();

    expect(screen.getByRole("dialog", { name: "Manage categories" })).toBeInTheDocument();
    expect(screen.getByText("compliance")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/content/categories");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("closed, it reads nothing", () => {
    render(<CategoriesDialog isOpen={false} onClose={jest.fn()} />);

    expect(mockedGet).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("no categories: says so", async () => {
    rows = [];
    render(<CategoriesDialog isOpen onClose={jest.fn()} />);

    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
  });

  it("adds a category (by Enter), trimmed, then reloads and tells the page", async () => {
    mockedPost.mockImplementation(async (_url: string, body: { name: string }) => {
      rows = [...rows, { id: "c2", name: body.name, slug: "iso-17025" }];
      return ok(rows[1]);
    });
    const { onChanged } = await open();

    fireEvent.keyDown(screen.getByLabelText("New category name"), { key: "Enter" });
    expect(mockedPost).not.toHaveBeenCalled(); // blank is ignored

    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "  ISO 17025 " } });
    fireEvent.keyDown(screen.getByLabelText("New category name"), { key: "Enter" });

    expect(await screen.findByText("ISO 17025")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/content/categories", { name: "ISO 17025" });
    expect(screen.getByLabelText("New category name")).toHaveValue("");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a refused create is reported and the name is kept", async () => {
    mockedPost.mockRejectedValue(httpError(403, "You do not have permission to create categories"));
    const { onChanged } = await open();

    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));

    await errorToast("You do not have permission to create categories");
    expect(screen.getByLabelText("New category name")).toHaveValue("Ops");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("renames a category, and a rename can be cancelled", async () => {
    mockedPatch.mockImplementation(async (_url: string, body: { name: string }) => {
      rows = [{ ...rows[0], name: body.name }];
      return ok(rows[0]);
    });
    const { onChanged } = await open();

    fireEvent.click(screen.getByRole("button", { name: "Rename Compliance" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(screen.getByText("Compliance")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rename Compliance" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename Compliance" }), { target: { value: "Regulatory" } });
    fireEvent.click(screen.getByRole("button", { name: "Save category name" }));

    expect(await screen.findByText("Regulatory")).toBeInTheDocument();
    expect(mockedPatch).toHaveBeenCalledWith("/api/v1/content/categories/c1", { name: "Regulatory" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a rename of a category that is gone (404) is reported", async () => {
    mockedPatch.mockRejectedValue(httpError(404, "Category not found"));
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Rename Compliance" }));
    fireEvent.click(screen.getByRole("button", { name: "Save category name" }));

    await errorToast("Category not found");
  });

  it("deletes a category", async () => {
    mockedDelete.mockImplementation(async () => {
      rows = [];
      return ok(null);
    });
    const { onChanged } = await open();

    fireEvent.click(screen.getByRole("button", { name: "Delete Compliance" }));

    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/content/categories/c1");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a failed delete is reported and the category stays", async () => {
    mockedDelete.mockRejectedValue(httpError(500, "Delete failed on the server"));
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Delete Compliance" }));

    await errorToast("Delete failed on the server");
    expect(screen.getByText("Compliance")).toBeInTheDocument();
  });
});

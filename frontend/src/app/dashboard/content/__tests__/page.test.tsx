/** @jest-environment jsdom */
/**
 * The CMS list (Blog & News) against GET /api/v1/content/posts
 * (content.controller.ts: rows in `data`, `meta` top-level {total, page,
 * limit, totalPages}) and DELETE /api/v1/content/posts/:id. The real content
 * service runs; `@/api/client`'s transport is mocked.
 *
 * Three states: loading, empty, and FAILED — a failed load shows the error
 * and never the "no posts yet" empty state (docs/FRONTEND/10-TESTING.md).
 * Fail-before: the page rendered the error AND "No posts yet — create your
 * first one." under it, telling the user the CMS was empty when it had not
 * been read.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import ContentPage from "../page";
import { useToastStore } from "@/stores/toastStore";
import { httpError, networkError } from "@/tests/support/httpErrors";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const post = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  type: "BLOG",
  title: "Why calibration matters",
  slug: "why-calibration-matters",
  excerpt: null,
  coverImageUrl: null,
  status: "PUBLISHED",
  publishedAt: "2026-09-01T00:00:00.000Z",
  readingMinutes: 3,
  featured: false,
  categories: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const list = (rows: unknown[], meta: Record<string, number> = {}) => ({
  success: true,
  status: 200,
  message: "Fetch posts successful",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1, ...meta },
});

const cats = { success: true, status: 200, message: "ok", data: [], meta: null };

/** The backend: posts for /content/posts, categories for the dialog. */
const backend = (posts: unknown) =>
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/content/posts") return typeof posts === "function" ? posts() : posts;
    if (url === "/api/v1/content/categories") return cats;
    throw new Error(`unexpected GET ${url}`);
  });

const lastParams = () =>
  (mockedGet.mock.calls.filter(([u]) => u === "/api/v1/content/posts").at(-1)?.[1] as {
    params: Record<string, unknown>;
  }).params;

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ content: "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("Content page", () => {
  it("lists posts with their public path, type, status and categories", async () => {
    backend(
      list([
        post({
          categories: [
            { id: "c1", name: "Compliance", slug: "compliance" },
            { id: "c2", name: "ISO", slug: "iso" },
            { id: "c3", name: "KARS", slug: "kars" },
            { id: "c4", name: "Ops", slug: "ops" },
          ],
        }),
        post({ id: "p2", type: "NEWS", title: "New lab opens", slug: "new-lab", status: "DRAFT" }),
      ]),
    );
    const { container } = render(<ContentPage />);

    const row = (await screen.findByText("Why calibration matters")).closest("tr") as HTMLElement;
    expect(within(row).getByText("/blog/why-calibration-matters")).toBeInTheDocument();
    expect(within(row).getByText("Compliance")).toBeInTheDocument();
    expect(within(row).queryByText("Ops")).not.toBeInTheDocument();
    expect(within(row).getByText("+1")).toBeInTheDocument();
    // A published post links to its public page; a draft does not.
    expect(within(row).getByRole("link", { name: "View on site" })).toHaveAttribute(
      "href",
      "/blog/why-calibration-matters",
    );
    const draft = screen.getByText("New lab opens").closest("tr") as HTMLElement;
    expect(within(draft).getByText("/news/new-lab")).toBeInTheDocument();
    expect(within(draft).queryByRole("link", { name: "View on site" })).not.toBeInTheDocument();
    expect(lastParams()).toEqual({ page: 1, limit: 10, type: undefined, status: undefined });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no posts: the empty state", async () => {
    backend(list([]));
    render(<ContentPage />);

    expect(await screen.findByText(/No posts yet/)).toBeInTheDocument();
  });

  it.each([
    ["a 403", () => httpError(403, "You do not have permission to read content")],
    ["a 500", () => httpError(500, "Internal server error")],
    ["no response", () => networkError()],
  ])("%s: the error is shown and the empty state is not", async (_label, make) => {
    const err = make();
    backend(() => {
      throw err;
    });
    const { container } = render(<ContentPage />);

    expect(await screen.findByText(err.message)).toBeInTheDocument();
    expect(screen.queryByText(/No posts yet/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("filters by type and status, starting again from page 1", async () => {
    backend(list([post()], { total: 25, totalPages: 3 }));
    render(<ContentPage />);
    await screen.findByText("Why calibration matters");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastParams().page).toBe(2));

    fireEvent.click(screen.getByRole("button", { name: "All types" }));
    fireEvent.click(screen.getByRole("option", { name: "News" }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 1, type: "NEWS" }));

    fireEvent.click(screen.getByRole("button", { name: "All statuses" }));
    fireEvent.click(screen.getByRole("option", { name: "Archived" }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 1, type: "NEWS", status: "ARCHIVED" }));
  });

  it("pages forward and back, and the ends are disabled", async () => {
    backend(list([post()], { total: 20, totalPages: 2 }));
    render(<ContentPage />);
    await screen.findByText("Page 1 of 2");

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("edit goes to the post's editor", async () => {
    backend(list([post()]));
    render(<ContentPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/content/p1/edit");
  });

  it("delete asks for confirmation, can be cancelled, then deletes and reloads", async () => {
    backend(list([post()]));
    mockedDelete.mockResolvedValue({ success: true, status: 200, message: "Post deleted", data: null });
    render(<ContentPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockedDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const loadsBefore = mockedGet.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("/api/v1/content/posts/p1"));
    await waitFor(() => expect(mockedGet.mock.calls.length).toBeGreaterThan(loadsBefore));
    expect(useToastStore.getState().toasts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "success", title: "Post deleted" })]),
    );
  });

  it("a delete of a post that is gone (404) is reported", async () => {
    backend(list([post()]));
    mockedDelete.mockRejectedValue(httpError(404, "Post not found"));
    render(<ContentPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "error", title: "Post not found" })]),
      ),
    );
  });

  it("the categories dialog opens from the page", async () => {
    backend(list([]));
    render(<ContentPage />);
    await screen.findByText(/No posts yet/);

    fireEvent.click(screen.getByRole("button", { name: /Categories/ }));

    expect(await screen.findByRole("dialog", { name: "Manage categories" })).toBeInTheDocument();
  });
});

/**
 * ADR-102 — blog & news writes are gated on `content` write. A role holding `content` read sees the posts only.
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: Categories, New post, Edit and Delete rendered for every role.
 */
describe("ADR-102 — blog & news write controls follow the effective permission", () => {
  const writeControls = [
      /Categories/,
      /New post/,
      "Edit",
      "Delete",
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "content": "read" });
    backend(list([post({ id: "p1", title: "Why calibration matters", status: "PUBLISHED" })]));
    render(<ContentPage />);
    await screen.findByText("Why calibration matters");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    backend(list([post({ id: "p1", title: "Why calibration matters", status: "PUBLISHED" })]));
    render(<ContentPage />);
    await screen.findByText("Why calibration matters");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    backend(list([post({ id: "p1", title: "Why calibration matters", status: "PUBLISHED" })]));
    render(<ContentPage />);
    await screen.findByText("Why calibration matters");
    expect(screen.getAllByRole("button", { name: /New post/ }).length).toBeGreaterThan(0);
  });
});

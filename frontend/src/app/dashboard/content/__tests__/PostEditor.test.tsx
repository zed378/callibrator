/** @jest-environment jsdom */
/**
 * The post editor (new and edit) against the content API
 * (content.controller.ts / content.service.js):
 *  - GET  /api/v1/content/categories        → rows in `data`
 *  - GET  /api/v1/content/slug-check        → `data: { slug, available, suggestion }`
 *  - POST /api/v1/content/media             → `data: { url, fileName, mimeType, size }`
 *  - POST /api/v1/content/posts, PATCH /api/v1/content/posts/:id → `data: post`
 *  - GET  /api/v1/content/posts/:id         → `data: post`, 404 "Post not found"
 *
 * Real: the editor, the edit page, the content service. Mocked: the transport,
 * next/navigation, the layout, and the rich-text body (its own test covers it).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("@/components/editor/RichTextEditor", () =>
  function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
    return <textarea aria-label="Body HTML" value={value} onChange={(e) => onChange(e.target.value)} />;
  },
);
const mockPush = jest.fn();
const mockRefresh = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: mockRefresh }),
  useParams: () => mockParams,
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import NewPostPage from "../new/page";
import EditPostPage from "../[id]/edit/page";
import { useToastStore } from "@/stores/toastStore";
import { httpError } from "@/tests/support/httpErrors";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;

const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data, meta: null });

const categories = [
  { id: "c1", name: "Compliance", slug: "compliance" },
  { id: "c2", name: "News", slug: "news" },
];
const existing = {
  id: "p1",
  type: "NEWS",
  title: "Lab accredited",
  slug: "lab-accredited",
  excerpt: "Short",
  coverImageUrl: "/uploads/public/cms/cover.png",
  contentHtml: "<p>Body</p>",
  status: "PUBLISHED",
  authorName: "HDC Team",
  authorRole: "Quality",
  readingMinutes: 1,
  featured: true,
  categories: [{ id: "c1", name: "Compliance", slug: "compliance" }],
  createdAt: "2026-09-01T00:00:00.000Z",
};

const slugAnswers: Record<string, { available: boolean; suggestion: string }> = {};
const backend = () =>
  mockedGet.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    if (url === "/api/v1/content/categories") return ok(categories);
    if (url === "/api/v1/content/slug-check") {
      const slug = cfg?.params?.slug ?? "";
      const answer = slugAnswers[slug] ?? { available: true, suggestion: slug };
      return ok({ slug, ...answer }, "OK");
    }
    if (url === "/api/v1/content/posts/p1") return ok(existing);
    if (url.startsWith("/api/v1/content/posts/")) throw httpError(404, "Post not found");
    throw new Error(`unexpected GET ${url}`);
  });

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  for (const k of Object.keys(slugAnswers)) delete slugAnswers[k];
  mockParams = {};
  backend();
});

describe("New post", () => {
  it("derives the slug from the title and confirms it is free", async () => {
    const { container } = render(<NewPostPage />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Every Device, Calibrated!" } });

    expect(screen.getByLabelText("Slug (auto-generated from title)")).toHaveValue("every-device-calibrated");
    expect(screen.getByText(/Checking availability/)).toBeInTheDocument();
    expect(await screen.findByText(/is available/)).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/content/slug-check", {
      params: { slug: "every-device-calibrated", excludeId: undefined },
    });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a taken slug offers the backend's suggestion, which can be applied", async () => {
    slugAnswers["audit-day"] = { available: false, suggestion: "audit-day-2" };
    render(<NewPostPage />);

    fireEvent.change(screen.getByLabelText("Slug (auto-generated from title)"), { target: { value: "audit-day" } });

    expect(await screen.findByText("That slug is taken")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Use .audit-day-2./ }));
    expect(screen.getByLabelText("Slug (auto-generated from title)")).toHaveValue("audit-day-2");
    expect(await screen.findByText(/is available/)).toBeInTheDocument();

    // Once edited by hand, the title no longer rewrites the slug.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Something else" } });
    expect(screen.getByLabelText("Slug (auto-generated from title)")).toHaveValue("audit-day-2");
  });

  it("clearing the slug clears the availability line", async () => {
    render(<NewPostPage />);
    const slug = screen.getByLabelText("Slug (auto-generated from title)");

    fireEvent.change(slug, { target: { value: "x" } });
    await screen.findByText(/is available/);
    fireEvent.change(slug, { target: { value: "  " } });

    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checking availability/)).not.toBeInTheDocument();
  });

  it("a failed slug check says nothing rather than guessing", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/content/categories") return ok(categories);
      throw httpError(500, "boom");
    });
    render(<NewPostPage />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello" } });
    await waitFor(() => expect(screen.queryByText(/Checking availability/)).not.toBeInTheDocument());
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    expect(screen.queryByText("That slug is taken")).not.toBeInTheDocument();
  });

  it("a title is required before anything is saved", async () => {
    render(<NewPostPage />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Title is required" })]));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("creates the post with everything entered, and returns to the list", async () => {
    mockedPost.mockImplementation(async (url: string) => {
      if (url === "/api/v1/content/media") {
        return { success: true, status: 201, message: "Media uploaded", data: { url: "/uploads/public/cms/c.png", fileName: "c.png", mimeType: "image/png", size: 3 } };
      }
      if (url === "/api/v1/content/posts") return ok({ ...existing, id: "new" }, "Post created");
      throw new Error(`unexpected POST ${url}`);
    });
    const { container } = render(<NewPostPage />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Audit day" } });
    fireEvent.change(screen.getByLabelText("Excerpt"), { target: { value: "One line" } });
    fireEvent.change(screen.getByLabelText("Body HTML"), { target: { value: "<p>Hi</p>" } });
    fireEvent.change(screen.getByLabelText("Author name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Author role"), { target: { value: "QA" } });
    fireEvent.click(screen.getByRole("button", { name: /Type/ }));
    fireEvent.click(screen.getByRole("option", { name: "News item" }));
    fireEvent.click(screen.getByRole("button", { name: /Status/ }));
    fireEvent.click(screen.getByRole("option", { name: "Published" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as featured" }));
    fireEvent.click(await screen.findByRole("button", { name: /Categories/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Compliance/ }));

    const file = new File(["abc"], "c.png", { type: "image/png" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole("img", { name: "Cover" })).toHaveAttribute("src", "/uploads/public/cms/c.png");

    // Status "Published" relabels the action.
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/content"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/content/posts", {
      type: "NEWS",
      title: "Audit day",
      slug: "audit-day",
      excerpt: "One line",
      coverImageUrl: "/uploads/public/cms/c.png",
      contentHtml: "<p>Hi</p>",
      status: "PUBLISHED",
      authorName: "Ada",
      authorRole: "QA",
      featured: true,
      categoryIds: ["c1"],
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "success", title: "Post created" })]));
  });

  it("a refused save is reported and the editor stays open", async () => {
    mockedPost.mockRejectedValue(httpError(403, "You do not have permission to create content"));
    render(<NewPostPage />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Audit day" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toasts()).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "error", title: "You do not have permission to create content" })]),
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("a failed or URL-less cover upload is reported and no cover is set", async () => {
    mockedPost
      .mockRejectedValueOnce(httpError(400, "SVG is not allowed"))
      .mockResolvedValueOnce({ success: true, status: 201, message: "Media uploaded", data: null });
    const { container } = render(<NewPostPage />);
    const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input(), { target: { files: [new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })] } });
    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ title: "Cover upload failed" })]));

    fireEvent.change(input(), { target: { files: [new File(["a"], "a.png", { type: "image/png" })] } });
    await waitFor(() =>
      expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Cover upload returned no URL" })])),
    );
    expect(screen.queryByRole("img", { name: "Cover" })).not.toBeInTheDocument();
  });

  it("the back link returns to the list", () => {
    render(<NewPostPage />);

    fireEvent.click(screen.getByRole("button", { name: /All content/ }));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/content");
  });
});

describe("Edit post", () => {
  it("loads the post, keeps its slug when the title changes, and saves with PATCH", async () => {
    mockParams = { id: "p1" };
    mockedPatch.mockResolvedValue(ok(existing, "Post updated"));
    const { container } = render(<EditPostPage />);

    const title = await screen.findByLabelText("Title");
    expect(title).toHaveValue("Lab accredited");
    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute("src", existing.coverImageUrl);
    expect(screen.getByRole("button", { name: "Featured" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(title, { target: { value: "Lab accredited again" } });
    expect(screen.getByLabelText("Slug (auto-generated from title)")).toHaveValue("lab-accredited");

    fireEvent.click(screen.getByRole("button", { name: "Remove cover image" }));
    expect(screen.queryByRole("img", { name: "Cover" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/content"));
    expect(mockedPatch).toHaveBeenCalledWith(
      "/api/v1/content/posts/p1",
      expect.objectContaining({ title: "Lab accredited again", slug: "lab-accredited", coverImageUrl: "", categoryIds: ["c1"] }),
    );
    expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Post updated" })]));
  });

  it("the slug check excludes the post being edited", async () => {
    mockParams = { id: "p1" };
    render(<EditPostPage />);

    fireEvent.change(await screen.findByLabelText("Slug (auto-generated from title)"), { target: { value: "renamed" } });

    await screen.findByText(/is available/);
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/content/slug-check", { params: { slug: "renamed", excludeId: "p1" } });
  });

  it("a post that does not exist (404) shows the error and no editor", async () => {
    mockParams = { id: "gone" };
    const { container } = render(<EditPostPage />);

    expect(await screen.findByText("Post not found")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

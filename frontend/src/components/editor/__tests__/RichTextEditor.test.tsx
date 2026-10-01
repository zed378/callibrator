/** @jest-environment jsdom */
/**
 * The WYSIWYG editor (TipTap) used for blog/news bodies and ticket
 * descriptions: what it emits, what the toolbar does, and where an inserted
 * image is uploaded.
 *
 * Sanitisation: the editor does NOT sanitise — it emits TipTap's schema HTML,
 * which drops anything the schema has no node for (a <script>, an onerror
 * handler). The stored body is sanitised again by the backend at write time
 * (content.service.js sanitize-html) before the public pages render it.
 *
 * Real: the editor and the content service. Mocked: `@/api/client`'s
 * transport and the attachment service.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock("@/api/services/attachment.service", () => ({
  attachmentService: { upload: jest.fn() },
}));

import { api } from "@/api/client";
import { attachmentService } from "@/api/services/attachment.service";
import RichTextEditor from "../RichTextEditor";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedPost = api.post as jest.Mock;

beforeAll(() => {
  // ProseMirror measures the selection; jsdom has no layout.
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  // Tailwind's `hidden` (display:none) — the file input is not rendered.
  const style = document.createElement("style");
  style.textContent = ".hidden { display: none; }";
  document.head.appendChild(style);
});

/** A parent that keeps the value, as PostEditor does — the toolbar re-renders with it. */
function Host({ initial, onChange, ...rest }: { initial: string; onChange: (html: string) => void; imageResourceType?: string }) {
  const [value, setValue] = React.useState(initial);
  return (
    <RichTextEditor
      value={value}
      onChange={(html) => {
        setValue(html);
        onChange(html);
      }}
      {...rest}
    />
  );
}

/** Select the whole first paragraph, as a user dragging over it would. */
const selectFirstParagraph = (container: HTMLElement) => {
  const p = editable(container).querySelector("p") as HTMLElement;
  editable(container).focus();
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection() as Selection;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
};

const renderEditor = async (value = "<p>Hello</p>", props: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) => {
  const onChange = jest.fn();
  const view = render(<Host initial={value} onChange={onChange} {...props} />);
  await screen.findByRole("button", { name: "Bold" });
  return { ...view, onChange };
};

const editable = (container: HTMLElement) => container.querySelector(".ProseMirror") as HTMLElement;

describe("RichTextEditor", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the given HTML and a named toolbar", async () => {
    const { container } = await renderEditor("<h2>Title</h2><p>Body <strong>bold</strong></p>");

    expect(editable(container).querySelector("h2")).toHaveTextContent("Title");
    expect(editable(container).querySelector("strong")).toHaveTextContent("bold");
    for (const name of ["Italic", "Strikethrough", "Heading 2", "Heading 3", "Bullet list", "Numbered list", "Quote", "Link", "Insert image", "Undo", "Redo"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(await axeViolations(container)).toEqual([]);
    // The first render loads TipTap and axe; allow for a cold module cache.
  }, 20000);

  it("drops markup the schema does not know — scripts and event handlers never reach the output", async () => {
    const { container } = await renderEditor(
      '<p>safe</p><script>alert(1)</script><img src="/uploads/public/cms/a.png" onerror="alert(2)">',
    );

    expect(container.querySelector("script")).toBeNull();
    const img = editable(container).querySelector("img");
    expect(img).toHaveAttribute("src", "/uploads/public/cms/a.png");
    expect(img).not.toHaveAttribute("onerror");
  });

  it("a toolbar command changes the document and reports the new HTML", async () => {
    const { onChange } = await renderEditor("<p>Hello</p>");

    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("<ul>");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("<ul>"));
  });

  it.each([
    ["Heading 2", "<h2>"],
    ["Heading 3", "<h3>"],
    ["Numbered list", "<ol>"],
    ["Quote", "<blockquote>"],
  ])("%s turns the paragraph into %s", async (name, tag) => {
    const { onChange } = await renderEditor("<p>Hello</p>");
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain(tag));
  });

  it.each([
    ["Bold", "<strong>"],
    ["Italic", "<em>"],
    ["Strikethrough", "<s>"],
  ])("%s marks the selected text with %s", async (name, tag) => {
    const { container, onChange } = await renderEditor("<p>Hello</p>");
    await act(async () => selectFirstParagraph(container));
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain(tag));
  });

  it("a new value from outside replaces the content without echoing a change", async () => {
    const onChange = jest.fn();
    const { container, rerender } = render(<RichTextEditor value="<p>first</p>" onChange={onChange} />);
    await screen.findByRole("button", { name: "Bold" });

    rerender(<RichTextEditor value="<p>loaded post</p>" onChange={onChange} />);

    await waitFor(() => expect(editable(container)).toHaveTextContent("loaded post"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a link is set from the prompt, and an empty answer removes it", async () => {
    const prompt = jest.spyOn(window, "prompt");
    const { onChange } = await renderEditor("<p>Hello</p>");

    prompt.mockReturnValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(onChange).not.toHaveBeenCalled();

    prompt.mockReturnValueOnce("https://example.org");
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    prompt.mockReturnValueOnce("");
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(prompt).toHaveBeenCalledWith("Link URL", "https://");
    prompt.mockRestore();
  });

  it("a blog image is uploaded to the public CMS media class and embedded", async () => {
    mockedPost.mockResolvedValue({
      success: true,
      status: 201,
      message: "Media uploaded",
      data: { url: "/uploads/public/cms/pic.png", fileName: "pic.png", mimeType: "image/png", size: 3 },
    });
    const { container, onChange } = await renderEditor("<p>x</p>");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["abc"], "pic.png", { type: "image/png" })] } });
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('src="/uploads/public/cms/pic.png"'));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/content/media", expect.any(FormData));
    expect(attachmentService.upload).not.toHaveBeenCalled();
  });

  it("a pasted image in a ticket editor goes to the gated attachments store", async () => {
    (attachmentService.upload as jest.Mock).mockResolvedValue({ url: "/api/v1/attachments/9/download" });
    const { container, onChange } = await renderEditor("<p>x</p>", { imageResourceType: "Ticket" });
    const file = new File(["abc"], "shot.png", { type: "image/png" });

    await act(async () => {
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: { files: [file], types: ["Files"], getData: () => "" },
      });
      editable(container).dispatchEvent(paste);
    });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("/api/v1/attachments/9/download"));
    expect(attachmentService.upload).toHaveBeenCalledWith({ file, resourceType: "Ticket" });
  });

  it("a dropped non-image file is left to the editor and nothing is uploaded", async () => {
    const { container } = await renderEditor("<p>x</p>");

    await act(async () => {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: { files: [new File(["a"], "notes.txt", { type: "text/plain" })] },
      });
      editable(container).dispatchEvent(drop);
    });

    expect(mockedPost).not.toHaveBeenCalled();
    expect(attachmentService.upload).not.toHaveBeenCalled();
  });

  it("a failed upload embeds nothing", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedPost.mockRejectedValue(new Error("SVG is not allowed"));
    const { container, onChange } = await renderEditor("<p>x</p>");

    await act(async () => {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: { files: [new File(["a"], "a.png", { type: "image/png" })] },
      });
      editable(container).dispatchEvent(drop);
    });

    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(editable(container).querySelector("img")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

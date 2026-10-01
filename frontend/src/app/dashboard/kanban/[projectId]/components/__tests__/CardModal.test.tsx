/**
 * CardModal — the card detail editor. `@/api/client` is mocked with backend
 * envelopes, so the real kanban, attachment and user services run; the
 * requests asserted are the ones a user's action actually sends.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import type { KanbanCard } from "@/api/services/kanban.service";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpErrors";
import { kBoard, kCard, ok, usersEnvelope } from "@/tests/support/kanbanFixtures";
import type { ComponentProps } from "react";
import type { CardRelationsListener } from "../../hooks/useBoard";
import CardModal from "../CardModal";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const CARD_URL = "/api/v1/kanban/projects/proj-1/cards/c1";

const detail = (over: Partial<KanbanCard> = {}) =>
  kCard("c1", {
    title: "Replace SpO2 probe",
    description: "Ward 3",
    priority: "medium",
    labels: [{ id: "lab-1", name: "urgent-fix", color: "#ef4444" }],
    assignees: [{ id: "u-1", firstName: "Ana", lastName: "Owner", email: "ana@h.test" }],
    relations: [
      { id: "rel-1", type: "blocks", card: { id: "c3", cardKey: "KB-c3", title: "In flight", columnId: "col-doing" } },
    ],
    ...over,
  });

const attachmentsEnvelope = (rows: unknown[]) => ({
  success: true,
  status: 200,
  message: "ok",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 50, totalPages: 1 },
});

const attachment = (id: string, originalName: string, mimeType: string) => ({
  id,
  tenantId: "t-1",
  resourceType: "KanbanCard",
  resourceId: "c1",
  originalName,
  mimeType,
  size: 1024,
  url: `/api/v1/attachments/${id}/download`,
  createdAt: "2026-09-20T08:00:00.000Z",
});

let attachments: unknown[] = [];

const backend = (card: KanbanCard | Error = detail()) => {
  get.mockImplementation(async (url: string) => {
    if (url === CARD_URL) {
      if (card instanceof Error) throw card;
      return ok(card, "Card retrieved");
    }
    if (url === "/api/v1/attachments") return attachmentsEnvelope(attachments);
    if (url === "/api/v1/users/all")
      return usersEnvelope([
        { id: "u-1", firstName: "Ana", lastName: "Owner", email: "ana@h.test" },
        { id: "u-2", firstName: "Budi", lastName: "Tech", email: "budi@h.test" },
      ]);
    throw new Error(`unexpected GET ${url}`);
  });
  post.mockImplementation(async (url: string) => {
    if (url.endsWith("/signed-url"))
      return ok({ url: "https://files.test/signed/a-img", token: "t", expiresAt: "", expiresInSec: 3600 });
    throw new Error(`unexpected POST ${url}`);
  });
};

const props = {
  isOpen: true,
  projectId: "proj-1",
  cardId: "c1" as string | null,
  board: kBoard("owner"),
  canEdit: true,
  onClose: jest.fn(),
  onSaved: jest.fn(),
  onDeleted: jest.fn(),
};

const open = async (over: Partial<ComponentProps<typeof CardModal>> = {}) => {
  const view = render(<CardModal {...props} {...over} />);
  await screen.findByRole("textbox", { name: "Card title" });
  // Users (for the assignee picker) arrive on their own request.
  await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/users/all", expect.anything()));
  return view;
};

const pick = async (trigger: HTMLElement, option: string) => {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  attachments = [];
  backend();
});

describe("CardModal — reading a card", () => {
  it("renders nothing while closed and asks for nothing", () => {
    const { container } = render(<CardModal {...props} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it("loads the card's detail, links and attachments; an image gets a signed preview", async () => {
    attachments = [
      attachment("a-img", "gauge.png", "image/png"),
      attachment("a-pdf", "manual.pdf", "application/pdf"),
    ];
    const { container } = await open();

    expect(get).toHaveBeenCalledWith(CARD_URL);
    expect(get).toHaveBeenCalledWith("/api/v1/attachments", {
      params: { page: 1, limit: 50, resourceType: "KanbanCard", resourceId: "c1" },
    });
    expect(screen.getByRole("textbox", { name: "Card title" })).toHaveValue("Replace SpO2 probe");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Ward 3");
    expect(screen.getByText("KB-c1")).toBeInTheDocument();
    expect(screen.getByText("blocks")).toBeInTheDocument();
    expect(screen.getByText("KB-c3 · In flight")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "gauge.png" })).toHaveAttribute(
      "src",
      "https://files.test/signed/a-img",
    );
    expect(screen.getByText("manual.pdf")).toBeInTheDocument();
    // Only the image asked for a signed URL.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/v1/attachments/a-img/signed-url", { expiresInSec: 3600 });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an image whose signed URL is refused still lists by name", async () => {
    attachments = [attachment("a-img", "gauge.png", "image/png")];
    post.mockRejectedValue(httpError(403, "Forbidden"));
    await open();
    expect(await screen.findByText("gauge.png")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "gauge.png" })).not.toBeInTheDocument();
  });

  it("a card with no links and no attachments says so", async () => {
    backend(detail({ relations: [] }));
    await open();
    expect(await screen.findByText("No attachments.")).toBeInTheDocument();
    expect(screen.getByText("No links.")).toBeInTheDocument();
  });

  it("a card that no longer exists (404) shows the refusal, not an endless 'Loading…'", async () => {
    backend(httpError(404, "Card not found"));
    const { container } = render(<CardModal {...props} />);
    expect(await screen.findByText("Card not found")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a viewer sees the card read-only: no delete, upload, link or remove controls", async () => {
    attachments = [attachment("a-pdf", "manual.pdf", "application/pdf")];
    const { container } = await open({ canEdit: false, board: kBoard("viewer") });
    expect(screen.getByRole("textbox", { name: "Card title" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove relation/ })).not.toBeInTheDocument();
    await screen.findByText("manual.pdf");
    expect(screen.queryByRole("button", { name: /Remove attachment/ })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Close closes", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("CardModal — editing", () => {
  const saved = (over: Partial<KanbanCard>) => patch.mockResolvedValue(ok(detail(over), "Card updated"));

  it("a changed title is saved on blur, trimmed; an unchanged one sends nothing", async () => {
    await open();
    const title = screen.getByRole("textbox", { name: "Card title" });
    fireEvent.blur(title);
    expect(patch).not.toHaveBeenCalled();

    saved({ title: "Replace SpO2 probe (bed 4)" });
    fireEvent.change(title, { target: { value: "  Replace SpO2 probe (bed 4) " } });
    await act(async () => {
      fireEvent.blur(title);
    });
    expect(patch).toHaveBeenCalledWith(CARD_URL, { title: "Replace SpO2 probe (bed 4)" });
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ title: "Replace SpO2 probe (bed 4)" }));
  });

  it("a blank title is never sent", async () => {
    await open();
    const title = screen.getByRole("textbox", { name: "Card title" });
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.blur(title);
    expect(patch).not.toHaveBeenCalled();
  });

  it("the description is saved on blur", async () => {
    saved({ description: "Ward 3, bed 4" });
    await open();
    const desc = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(desc, { target: { value: "Ward 3, bed 4" } });
    await act(async () => {
      fireEvent.blur(desc);
    });
    expect(patch).toHaveBeenCalledWith(CARD_URL, { description: "Ward 3, bed 4" });
  });

  it("priority, sprint and due date each send only their own field", async () => {
    saved({});
    await open();

    await act(async () => {
      await pick(screen.getByRole("button", { name: /Priority/ }), "Urgent");
    });
    expect(patch).toHaveBeenLastCalledWith(CARD_URL, { priority: "urgent" });

    await act(async () => {
      await pick(screen.getByRole("button", { name: /Sprint/ }), "Sprint 1");
    });
    expect(patch).toHaveBeenLastCalledWith(CARD_URL, { sprintId: "s1" });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-15" } });
    });
    expect(patch).toHaveBeenLastCalledWith(CARD_URL, { dueDate: "2026-10-15" });
  });

  it("choosing Backlog sends sprintId null; clearing priority sends null", async () => {
    saved({});
    backend(detail({ sprintId: "s1" }));
    await open();
    await act(async () => {
      await pick(screen.getByRole("button", { name: /Sprint/ }), "Backlog");
    });
    expect(patch).toHaveBeenLastCalledWith(CARD_URL, { sprintId: null });
    await act(async () => {
      await pick(screen.getByRole("button", { name: /Priority/ }), "None");
    });
    expect(patch).toHaveBeenLastCalledWith(CARD_URL, { priority: null });
  });

  it("adding an assignee sends the full assignee list", async () => {
    saved({});
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Assignees" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Budi Tech" }));
    });
    expect(patch).toHaveBeenLastCalledWith(CARD_URL, { assigneeIds: ["u-1", "u-2"] });
  });

  it("removing a label sends the remaining labels", async () => {
    saved({ labels: [] });
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove urgent-fix" }));
    });
    expect(patch).toHaveBeenLastCalledWith(CARD_URL, { labelIds: [] });
  });

  it("a refused save (409) is shown instead of looking saved", async () => {
    patch.mockRejectedValue(httpError(409, "A card in a completed sprint cannot be edited"));
    const { container } = await open();
    const title = screen.getByRole("textbox", { name: "Card title" });
    fireEvent.change(title, { target: { value: "New title" } });
    await act(async () => {
      fireEvent.blur(title);
    });
    expect(await screen.findByText("A card in a completed sprint cannot be edited")).toBeInTheDocument();
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("CardModal — links", () => {
  it("links a card with the chosen relation type and shows the returned links", async () => {
    await open();
    post.mockImplementation(async (url: string) => {
      if (url.endsWith("/relations"))
        return ok([
          { id: "rel-2", type: "duplicates", card: { id: "c2", cardKey: "KB-c2", title: "Second", columnId: "col-todo" } },
        ]);
      throw new Error(url);
    });
    await pick(screen.getByRole("button", { name: "relates to" }), "duplicates");
    await pick(screen.getByRole("button", { name: "Select card…" }), "KB-c2 · Second");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
    });
    expect(post).toHaveBeenCalledWith(`${CARD_URL}/relations`, { targetCardId: "c2", type: "duplicates" });
    expect(await screen.findByText("KB-c2 · Second")).toBeInTheDocument();
    // The card itself is never offered as a link target.
    fireEvent.click(screen.getByRole("button", { name: "Select card…" }));
    expect(screen.queryByRole("option", { name: /Replace SpO2 probe/ })).not.toBeInTheDocument();
  });

  it("Link with no target chosen sends nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(post).not.toHaveBeenCalledWith(expect.stringContaining("/relations"), expect.anything());
  });

  it("a refused link is shown", async () => {
    await open();
    post.mockRejectedValue(httpError(409, "These cards are already linked"));
    await pick(screen.getByRole("button", { name: "Select card…" }), "KB-c2 · Second");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
    });
    expect(await screen.findByText("These cards are already linked")).toBeInTheDocument();
  });

  it("removing a link DELETEs it and shows what remains", async () => {
    await open();
    del.mockResolvedValue(ok([]));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove relation to KB-c3" }));
    });
    expect(del).toHaveBeenCalledWith(`${CARD_URL}/relations/rel-1`);
    expect(await screen.findByText("No links.")).toBeInTheDocument();
  });

  it("a failed unlink is shown and the link stays", async () => {
    await open();
    del.mockRejectedValue(httpError(404, "Relation not found"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove relation to KB-c3" }));
    });
    expect(await screen.findByText("Relation not found")).toBeInTheDocument();
    expect(screen.getByText("KB-c3 · In flight")).toBeInTheDocument();
  });
});

describe("CardModal — attachments", () => {
  const fileInput = () => screen.getByLabelText("Upload an image to this card");

  it("uploads the chosen image against this card, then lists it", async () => {
    await open();
    post.mockImplementation(async (url: string) => {
      if (url === "/api/v1/attachments") {
        attachments = [attachment("a-new", "reading.jpg", "image/jpeg")];
        return ok(attachments[0]);
      }
      if (url.endsWith("/signed-url"))
        return ok({ url: "https://files.test/signed/a-new", token: "t", expiresAt: "", expiresInSec: 3600 });
      throw new Error(url);
    });
    const file = new File(["x"], "reading.jpg", { type: "image/jpeg" });
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [file] } });
    });
    const [url, body] = post.mock.calls.find(([u]) => u === "/api/v1/attachments") as [string, FormData];
    expect(url).toBe("/api/v1/attachments");
    expect(body.get("file")).toBe(file);
    expect(body.get("resourceType")).toBe("KanbanCard");
    expect(body.get("resourceId")).toBe("c1");
    expect(await screen.findByRole("img", { name: "reading.jpg" })).toBeInTheDocument();
  });

  it("a refused upload (virus scan, size) is shown", async () => {
    await open();
    post.mockRejectedValue(httpError(422, "File rejected by the virus scanner"));
    await act(async () => {
      fireEvent.change(fileInput(), {
        target: { files: [new File(["x"], "bad.png", { type: "image/png" })] },
      });
    });
    expect(await screen.findByText("File rejected by the virus scanner")).toBeInTheDocument();
  });

  it("removing an attachment DELETEs it and reloads the list", async () => {
    attachments = [attachment("a-pdf", "manual.pdf", "application/pdf")];
    await open();
    del.mockImplementation(async () => {
      attachments = [];
      return ok({ id: "a-pdf" });
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Remove attachment manual.pdf" }));
    });
    expect(del).toHaveBeenCalledWith("/api/v1/attachments/a-pdf");
    expect(await screen.findByText("No attachments.")).toBeInTheDocument();
  });

  it("a failed removal is shown", async () => {
    attachments = [attachment("a-pdf", "manual.pdf", "application/pdf")];
    await open();
    del.mockRejectedValue(httpError(403, "You cannot delete this attachment"));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Remove attachment manual.pdf" }));
    });
    expect(await screen.findByText("You cannot delete this attachment")).toBeInTheDocument();
  });
});

describe("CardModal — delete", () => {
  it("asks first, naming the card, then DELETEs it and closes", async () => {
    const { container } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this card?" });
    expect(within(dialog).getByText(/KB-c1 — "Replace SpO2 probe" will be permanently removed/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    del.mockResolvedValue(ok({ deleted: true }, "Card deleted"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete card" }));
    });
    expect(del).toHaveBeenCalledWith(CARD_URL);
    expect(props.onDeleted).toHaveBeenCalledWith("c1");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("Cancel keeps the card", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this card?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete this card?" })).not.toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
  });

  it("a refused delete (403) is shown and the modal stays open", async () => {
    await open();
    del.mockRejectedValue(httpError(403, "Only an editor can delete cards"));
    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this card?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete card" }));
    });
    expect(await screen.findByText("Only an editor can delete cards")).toBeInTheDocument();
    expect(props.onDeleted).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

// F-19 — the card editor is a modal dialog, not a styled div: named by the
// card, focus moved in and trapped, Escape closes, focus back to the opener.
describe("CardModal — a real dialog (F-19)", () => {
  it("F-19: is a modal dialog named by the card's key and title", async () => {
    await open();
    const dialog = screen.getByRole("dialog", { name: "KB-c1 Replace SpO2 probe" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("F-19: focus moves into the dialog when it opens", async () => {
    await open();
    const dialog = screen.getByRole("dialog", { name: "KB-c1 Replace SpO2 probe" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("F-19: Escape closes the card", async () => {
    await open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("F-19: with the delete confirmation open, Escape closes only the confirmation", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    await screen.findByRole("dialog", { name: "Delete this card?" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Delete this card?" })).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("F-19: Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last", async () => {
    await open();
    const dialog = screen.getByRole("dialog", { name: "KB-c1 Replace SpO2 probe" });
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]):not([type='hidden']), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    act(() => last.focus());
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("F-19: closing returns focus to the control that opened it", async () => {
    const opener = document.createElement("button");
    opener.textContent = "KB-c1";
    document.body.appendChild(opener);
    opener.focus();
    const view = await open();
    expect(document.activeElement).not.toBe(opener);
    view.rerender(<CardModal {...props} isOpen={false} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

// F-19 — links changed by someone else arrive as `kanban:card:relations`
// (backend kanban.service.js addRelation/removeRelation: { cardId, relations }
// for the SOURCE card), fanned out by useBoard.subscribeCardRelations.
describe("CardModal — live link updates (F-19)", () => {
  type Listener = CardRelationsListener;
  const feed = () => {
    const listeners = new Set<Listener>();
    return {
      subscribe: jest.fn((l: Listener) => {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      }),
      emit: (event: Parameters<Listener>[0]) =>
        act(async () => {
          listeners.forEach((l) => l(event));
        }),
      size: () => listeners.size,
    };
  };
  const rel = (id: string, cardId: string, title: string) => ({
    id,
    type: "relates_to" as const,
    card: { id: cardId, cardKey: `KB-${cardId}`, title, columnId: "col-todo" },
  });

  it("F-19: an event for the open card replaces its links with the event's", async () => {
    const f = feed();
    await open({ subscribeRelations: f.subscribe });
    await f.emit({ cardId: "c1", relations: [rel("rel-9", "c2", "Second")] });
    expect(await screen.findByText("KB-c2 · Second")).toBeInTheDocument();
    expect(screen.queryByText("KB-c3 · In flight")).not.toBeInTheDocument();
  });

  it("F-19: an event for a card linked to the open one reloads the open card's links (the mirror row)", async () => {
    const f = feed();
    await open({ subscribeRelations: f.subscribe });
    // c3 dropped its link to c1: the event names c3, not c1.
    backend(detail({ relations: [] }));
    get.mockClear();
    await f.emit({ cardId: "c3", relations: [] });
    expect(get).toHaveBeenCalledWith(CARD_URL);
    expect(await screen.findByText("No links.")).toBeInTheDocument();
  });

  it("F-19: an event for an unrelated card asks for nothing", async () => {
    const f = feed();
    await open({ subscribeRelations: f.subscribe });
    get.mockClear();
    await f.emit({ cardId: "c7", relations: [rel("rel-8", "c8", "Other")] });
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText("KB-c3 · In flight")).toBeInTheDocument();
  });

  it("F-19: closing the card unsubscribes it", async () => {
    const f = feed();
    const view = await open({ subscribeRelations: f.subscribe });
    expect(f.size()).toBe(1);
    view.rerender(<CardModal {...props} isOpen={false} subscribeRelations={f.subscribe} />);
    expect(f.size()).toBe(0);
  });
});

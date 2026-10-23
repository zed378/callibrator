/** @jest-environment jsdom */
/**
 * C-2 (P26-01 § 9; P19-02 spec § 12) — the IPM capture's evidence photos on the dashboard
 * checklist. Before this card the dashboard could fill an IPM but not attach a photo; only
 * `/field` could (UAT step TP-07).
 *
 * Real: the component, the attachment service and the typed client. Mocked: the HTTP client, the
 * browser's image codec (`lib/photoPrep` — jsdom has no canvas), and the dashboard chrome.
 *
 * Pins: the photos already on the session are listed and each shown through a signed link to the
 * ORIGINAL (an `ipm_evidence` photo has no derivative — a `variant` would 404); an empty list says
 * so; a failed load is a FAILED state, never an empty list; adding a photo uploads it as
 * `inspectionsession` + the session id (the server sets `purpose = ipm_evidence`); a refused upload
 * is shown in the server's words; a HEIC the browser cannot convert is explained; removing asks
 * first and then deletes; a read-only (submitted) IPM offers no add or remove; ID/EN.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

jest.mock("@/lib/photoPrep", () => {
    const actual = jest.requireActual("@/lib/photoPrep");
    return { ...actual, preparePhoto: jest.fn(async () => new File(["jpeg"], "prepared.jpg", { type: "image/jpeg" })) };
});
jest.mock("@/api/client", () => {
    const actual = jest.requireActual("@/api/client");
    return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { preparePhoto, PhotoPrepError } from "@/lib/photoPrep";
import { EvidencePhotos, IPM_EVIDENCE_RESOURCE_TYPE } from "../EvidencePhotos";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const del = api.delete as jest.Mock;
const prepare = preparePhoto as jest.Mock;

const S = "5a000000-0000-4000-8000-000000000001";
const P1 = "a7000000-0000-4000-8000-0000000000f1";
const P2 = "a7000000-0000-4000-8000-0000000000f2";
const P3 = "a7000000-0000-4000-8000-0000000000f3";

const ok = <T,>(data: T) => ({ success: true, status: 200, message: "ok", data });

const photo = (id: string, name: string) => ({
    id,
    tenantId: "t1",
    resourceType: "inspectionsession",
    resourceId: S,
    fileName: `${id}.jpg`,
    originalName: name,
    mimeType: "image/jpeg",
    size: 1200,
    checksum: "abc",
    uploadedBy: "u1",
    url: `/api/v1/attachments/${id}/download`,
    createdAt: "2026-10-23T02:00:00.000Z",
});

/** The upload call alone (not the signed links, which are POSTs to another path). */
const uploadCalls = () => post.mock.calls.filter((c) => c[0] === "/api/v1/attachments");

const renderIt = (editable = true, messages = en, locale: "en" | "id" = "en") =>
    render(
        <MessagesProvider locale={locale} messages={messages}>
            <EvidencePhotos sessionId={S} editable={editable} />
        </MessagesProvider>,
    );

beforeEach(() => {
    jest.clearAllMocks();
    prepare.mockImplementation(async () => new File(["jpeg"], "prepared.jpg", { type: "image/jpeg" }));
    get.mockImplementation((path: string) => {
        if (path === "/api/v1/attachments") return Promise.resolve({ ...ok([photo(P1, "front.jpg"), photo(P2, "plate.jpg")]), meta: { total: 2, page: 1, limit: 50, totalPages: 1 } });
        return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    post.mockImplementation((path: string) => {
        if (path === "/api/v1/attachments") return Promise.resolve({ data: photo(P3, "prepared.jpg") });
        if (path.endsWith("/signed-url")) {
            return Promise.resolve(ok({ url: `https://api.example.invalid${path.replace("/signed-url", "/signed")}?token=abc`, token: "abc", expiresAt: "x", expiresInSec: 300 }));
        }
        return Promise.reject(new Error(`unexpected POST ${path}`));
    });
    del.mockResolvedValue(ok({ id: P1 }));
});

describe("C-2 — the IPM evidence photos on the dashboard checklist", () => {
    it("lists the session's photos, each through a signed link to the original, and is axe-clean", async () => {
        const { container } = renderIt();
        expect(await screen.findByRole("heading", { name: "Evidence photos (2)" })).toBeInTheDocument();
        expect(get).toHaveBeenCalledWith("/api/v1/attachments", { params: { resourceType: IPM_EVIDENCE_RESOURCE_TYPE, resourceId: S, page: 1, limit: 50 } });
        await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
        // No `variant`: an ipm_evidence photo has no derivative.
        expect(post).toHaveBeenCalledWith(`/api/v1/attachments/${P1}/signed-url`, {});
        expect(screen.getByAltText("front.jpg")).toHaveAttribute("src", `/api/v1/attachments/${P1}/signed?token=abc`);
        expect(await axeViolations(container)).toEqual([]);
    });

    it("an empty list says so — a FAILED load is a failure, never an empty list", async () => {
        get.mockResolvedValueOnce({ ...ok([]), meta: { total: 0, page: 1, limit: 50, totalPages: 1 } });
        const first = renderIt();
        expect(await screen.findByText("No evidence photo yet.")).toBeInTheDocument();
        first.unmount();

        get.mockRejectedValueOnce(httpError(500, "The server could not answer"));
        renderIt();
        expect(await screen.findByText("The photos could not be loaded.")).toBeInTheDocument();
        expect(screen.queryByText("No evidence photo yet.")).not.toBeInTheDocument();
    });

    it("a retry reloads after a failed load", async () => {
        get.mockRejectedValueOnce(new Error("offline"));
        renderIt();
        expect(await screen.findByText("The photos could not be loaded.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByRole("heading", { name: "Evidence photos (2)" })).toBeInTheDocument();
    });

    it("adding a photo uploads it against the session, and the server sets the purpose", async () => {
        renderIt();
        await screen.findByRole("heading", { name: "Evidence photos (2)" });
        const input = screen.getByLabelText("Add an evidence photo");
        fireEvent.change(input, { target: { files: [new File(["x"], "IMG_0001.heic", { type: "image/heic" })] } });

        await waitFor(() => expect(uploadCalls()).toHaveLength(1));
        const form = uploadCalls()[0]?.[1] as FormData;
        expect(form.get("resourceType")).toBe("inspectionsession");
        expect(form.get("resourceId")).toBe(S);
        expect((form.get("file") as File).name).toBe("prepared.jpg");
        expect(prepare).toHaveBeenCalled();
        // The list grows by the photo the server answered.
        expect(await screen.findByRole("heading", { name: "Evidence photos (3)" })).toBeInTheDocument();
    });

    it("a refused upload is shown in the server's words; a HEIC the browser cannot convert is explained", async () => {
        // The upload path alone refuses: the signed links for the two listed photos still answer.
        post.mockImplementation((path: string) => {
            if (path === "/api/v1/attachments") return Promise.reject(httpError(409, "Photos are added to an IPM draft only; this IPM is submitted."));
            return Promise.resolve(ok({ url: `https://api.example.invalid${path.replace("/signed-url", "/signed")}?token=abc`, token: "abc", expiresAt: "x", expiresInSec: 300 }));
        });
        const first = renderIt();
        await screen.findByRole("heading", { name: "Evidence photos (2)" });
        fireEvent.change(screen.getByLabelText("Add an evidence photo"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
        expect(await screen.findByText("Photos are added to an IPM draft only; this IPM is submitted.")).toBeInTheDocument();
        first.unmount();

        prepare.mockRejectedValueOnce(new PhotoPrepError("heic_unreadable"));
        renderIt();
        await screen.findByRole("heading", { name: "Evidence photos (2)" });
        const before = uploadCalls().length; // the refused attempt above already counted once
        fireEvent.change(screen.getByLabelText("Add an evidence photo"), { target: { files: [new File(["x"], "b.heic", { type: "image/heic" })] } });
        expect(await screen.findByText(/This photo is in HEIC format/)).toBeInTheDocument();
        // A photo the browser cannot decode is never sent: no further upload call.
        expect(uploadCalls()).toHaveLength(before);
    });

    it("removing asks first, then deletes", async () => {
        renderIt();
        await screen.findByRole("heading", { name: "Evidence photos (2)" });
        const removes = screen.getAllByRole("button", { name: "Remove the photo" });
        fireEvent.click(removes[0] as HTMLElement);
        expect(screen.getByRole("heading", { name: "Remove this photo?" })).toBeInTheDocument();
        expect(del).not.toHaveBeenCalled();

        const dialog = screen.getByRole("heading", { name: "Remove this photo?" }).closest("[role='dialog']") as HTMLElement | null;
        const scope = dialog ?? document.body;
        fireEvent.click(within(scope).getByRole("button", { name: "Remove the photo" }));

        await waitFor(() => expect(del).toHaveBeenCalledWith(`/api/v1/attachments/${P1}`));
        expect(await screen.findByRole("heading", { name: "Evidence photos (1)" })).toBeInTheDocument();
    });

    it("a submitted IPM (read-only) offers neither add nor remove", async () => {
        renderIt(false);
        await screen.findByRole("heading", { name: "Evidence photos (2)" });
        expect(screen.queryByLabelText("Add an evidence photo")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Remove the photo" })).not.toBeInTheDocument();
        expect(screen.getByText(/A submitted IPM's photos are part of its record\./)).toBeInTheDocument();
    });

    it("Indonesian", async () => {
        renderIt(true, idMessages, "id");
        expect(await screen.findByRole("heading", { name: "Foto bukti (2)" })).toBeInTheDocument();
        expect(screen.queryByText("Belum ada foto bukti.")).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Hapus foto" })).toHaveLength(2);
    });
});

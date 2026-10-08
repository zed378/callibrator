/** @jest-environment jsdom */
/**
 * A-118 — the upload sends a record id only for a linkable type.
 *
 * The modal hides the id field for "General"; this is the second half: a
 * form state that still carries an id for an unlinkable type (set before the
 * type changed, or by any other path) must not send it, because the backend
 * answers a 400 (attachment.service LINKABLE_RESOURCES, A-97).
 */
import { renderHook, act, waitFor } from "@testing-library/react";

jest.mock("@/api/services/attachment.service", () => ({
  attachmentService: {
    getAll: jest.fn(async () => ({ data: [], meta: { total: 0 } })),
    upload: jest.fn(async () => ({ id: "att-1" })),
  },
}));

import { useAttachments } from "../useAttachments";
import { attachmentService } from "@/api/services/attachment.service";

const upload = attachmentService.upload as jest.Mock;
const FILE = new File(["x"], "a.pdf", { type: "application/pdf" });
const submitEvent = { preventDefault: jest.fn() } as unknown as React.FormEvent;

const submitWith = async (resourceType: string, resourceId: string) => {
  const { result } = renderHook(() => useAttachments());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  act(() => {
    result.current.setFile(FILE);
    result.current.setForm({ resourceType, resourceId });
  });
  await act(async () => {
    await result.current.handleUploadSubmit(submitEvent);
  });
};

beforeEach(() => jest.clearAllMocks());

describe("A-118 — useAttachments#handleUploadSubmit", () => {
  it("drops a record id for an unlinkable type", async () => {
    await submitWith("generic", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(upload).toHaveBeenCalledWith({ file: FILE, resourceType: "generic", resourceId: undefined });
  });

  it("sends the record id for a linkable type", async () => {
    await submitWith("device", " aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa ");

    expect(upload).toHaveBeenCalledWith({
      file: FILE,
      resourceType: "device",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("an empty id for a linkable type is a standalone file", async () => {
    await submitWith("certificate", "  ");

    expect(upload).toHaveBeenCalledWith({ file: FILE, resourceType: "certificate", resourceId: undefined });
  });
});

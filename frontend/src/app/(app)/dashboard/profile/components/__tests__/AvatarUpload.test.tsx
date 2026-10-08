/** @jest-environment jsdom */
/**
 * The profile picture control. POST /api/v1/users/:id/avatar (multipart,
 * multer: 2MB, jpeg/png/gif/webp — user.route.js) and DELETE on the same path.
 * A file the server would refuse is refused here first, with the reason.
 *
 * Real: the component and the user service. Mocked: the transport and the
 * object-URL API jsdom lacks.
 */
import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { post: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import AvatarUpload from "../AvatarUpload";
import { useToastStore } from "@/stores/toastStore";
import { httpError } from "@/tests/support/httpErrors";
import type { User } from "@/types";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const user = { id: "u1", username: "ada", firstName: "Ada" } as User;

function Host({ avatarUrl = "", onAvatarUpload = jest.fn().mockResolvedValue(undefined) }: { avatarUrl?: string; onAvatarUpload?: () => Promise<void> }) {
  const [isUploading, setIsUploading] = useState(false);
  return (
    <AvatarUpload
      user={user}
      avatarUrl={avatarUrl}
      onAvatarUpload={onAvatarUpload}
      isUploading={isUploading}
      setIsUploading={setIsUploading}
    />
  );
}

const choose = (file: File) =>
  fireEvent.change(screen.getByLabelText("Upload avatar image file"), { target: { files: [file] } });
const toasts = () => useToastStore.getState().toasts;

beforeAll(() => {
  Object.assign(URL, { createObjectURL: jest.fn(() => "blob:preview"), revokeObjectURL: jest.fn() });
});
beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("AvatarUpload", () => {
  it("uploads a valid image, shows it, and tells the page to refresh", async () => {
    let finish: () => void = () => undefined;
    mockedPost.mockReturnValue(new Promise<void>((r) => { finish = r; }));
    const onAvatarUpload = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<Host onAvatarUpload={onAvatarUpload} />);
    expect(await axeViolations(container)).toEqual([]);

    const file = new File(["png"], "me.png", { type: "image/png" });
    choose(file);

    // While uploading, the button says so and cannot be pressed again.
    expect(await screen.findByRole("button", { name: /Uploading/ })).toBeDisabled();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/users/u1/avatar", expect.any(FormData));
    const body = mockedPost.mock.calls[0][1] as FormData;
    expect(body.get("file")).toBe(file);
    expect(body.get("userId")).toBe("u1");

    await act(async () => finish());
    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "success", title: "Profile picture updated" })]));
    expect(onAvatarUpload).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Upload$/ })).toBeEnabled();
  });

  it.each([
    [new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), "Unsupported image type"],
    [new File([new Uint8Array(3 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }), "Image is too large"],
  ])("refuses %p before sending: %s", async (file, title) => {
    render(<Host />);

    choose(file);

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title })]));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("says how big a too-large file is", async () => {
    render(<Host />);
    choose(new File([new Uint8Array(3 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(toasts()[0]).toMatchObject({ description: "Maximum size is 2MB — this file is 3.0MB." }));
  });

  it("a refused upload restores the previous picture and says why", async () => {
    mockedPost.mockRejectedValue(httpError(413, "File too large"));
    render(<Host avatarUrl="/uploads/public/profile/old.png" />);

    choose(new File(["png"], "me.png", { type: "image/png" }));

    await waitFor(() =>
      expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Upload failed", description: "File too large" })]),
    );
    expect(screen.getByRole("button", { name: /Remove/ })).toBeInTheDocument();
  });

  it("removes the picture", async () => {
    mockedDelete.mockResolvedValue({ success: true, status: 200, message: "ok", data: null });
    const onAvatarUpload = jest.fn().mockResolvedValue(undefined);
    render(<Host avatarUrl="/uploads/public/profile/old.png" onAvatarUpload={onAvatarUpload} />);

    fireEvent.click(await screen.findByRole("button", { name: /Remove/ }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ title: "Profile picture removed" })]));
    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/users/u1/avatar");
    expect(onAvatarUpload).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("a failed removal is reported and the picture stays", async () => {
    mockedDelete.mockRejectedValue(httpError(403, "Forbidden"));
    render(<Host avatarUrl="/uploads/public/profile/old.png" />);

    fireEvent.click(await screen.findByRole("button", { name: /Remove/ }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ title: "Could not remove picture", description: "Forbidden" })]));
    expect(screen.getByRole("button", { name: /Remove/ })).toBeInTheDocument();
  });

  it("with no picture there is nothing to remove", () => {
    render(<Host />);

    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("the picture itself opens the file chooser, by click or keyboard", () => {
    render(<Host />);
    const input = screen.getByLabelText("Upload avatar image file") as HTMLInputElement;
    const click = jest.spyOn(input, "click").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: /Upload$/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: "ada" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "ada" }));

    expect(click).toHaveBeenCalledTimes(3);
  });
});

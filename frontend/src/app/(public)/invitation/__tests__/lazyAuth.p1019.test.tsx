/** @jest-environment jsdom */
/**
 * P10-19 — /invitation's API layer loads on demand (the /login pattern, P10-17).
 *
 * The auth service (axios, the API client, the access-denied store) was part
 * of the page's first-load JavaScript through a static import. The form now
 * reaches it with import():
 *  - not while the page renders;
 *  - not for input outside <main> (the theme toggle, the language form);
 *  - once, at the first key press or tap inside <main> (prefetch);
 *  - and in any case before the submit talks to the API.
 * The request bodies are proven unchanged by invitation.p1015.test.tsx, which mocks the
 * API client underneath the service.
 *
 * Fail-before: with the static import the factory below ran when the form
 * module was imported, so the first assertion saw 1 load, not 0.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams({ token: "inv-token-123" }),
}));

// Counted outside jest.fn so clearAllMocks cannot hide an import-time load.
let mockServiceLoads = 0;
const mockCall = jest.fn(async () => ({ success: true }));
jest.mock("@/api/services/auth.service", () => {
  mockServiceLoads += 1;
  return { authService: { acceptInvitation: mockCall } };
});

import { InvitationForm } from "../components/InvitationForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const renderInMain = () =>
  render(
    <main>
      <MessagesProvider locale="en" messages={en}>
        <InvitationForm />
      </MessagesProvider>
    </main>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, "", "/invitation?token=inv-token-123");
});

describe("P10-19: /invitation loads its API layer on demand", () => {
  it("is not loaded by rendering the form, nor by input outside <main>", async () => {
    const { unmount } = renderInMain();
    const header = document.body.appendChild(document.createElement("header"));
    const toggle = header.appendChild(document.createElement("button"));
    act(() => {
      toggle.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    await flush();
    expect(mockServiceLoads).toBe(0);
    header.remove();
    unmount();
  });

  it("is loaded once at the first key press inside <main>, then the listeners go", async () => {
    const remove = jest.spyOn(document, "removeEventListener");
    const { unmount } = renderInMain();
    const field = screen.getByLabelText(en["auth.first.newPassword"]);
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    await flush();
    expect(mockServiceLoads).toBe(1);
    for (const type of ["keydown", "pointerdown", "touchstart"]) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function), true);
    }
    unmount();
    remove.mockRestore();
  });

  it("a submit awaits the same import and reaches the service", async () => {
    renderInMain();
    fireEvent.change(screen.getByLabelText(en["auth.first.newPassword"]), { target: { value: "Chosen-Pass-42" } });
    fireEvent.change(screen.getByLabelText(en["auth.first.confirm"]), { target: { value: "Chosen-Pass-42" } });
    fireEvent.click(screen.getByRole("button", { name: en["invite.submit"] }));
    await waitFor(() => expect(mockCall).toHaveBeenCalledTimes(1));
    expect(mockCall).toHaveBeenCalledWith("inv-token-123", "Chosen-Pass-42");
  });
});

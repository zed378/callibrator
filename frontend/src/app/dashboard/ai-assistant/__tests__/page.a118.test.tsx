/** @jest-environment jsdom */
/**
 * A-118 — the AI Assistant page for a role that lacks one of its grants.
 *
 * POST /ai/query is gated on `sop` read and POST /ai/ocr on `certificate`
 * write. A role holding one and not the other got an error toast for the
 * other — "Query failed" / "OCR failed" — which reads as a fault, not as a
 * permission it does not have. A 403 now shows a notice in that card, names
 * the permission, and leaves the other card working. Any other failure is
 * still a toast.
 *
 * Fail-before: both 403s toasted, and the card stayed as it was.
 *
 * Real: the page and the toast store. Mocked: the layout and the AI client.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/services/ai.service", () => ({
  aiService: {
    query: jest.fn(),
    ocr: jest.fn(),
  },
}));

import AiAssistantPage from "../page";
import { aiService } from "@/api/services/ai.service";
import { useToastStore } from "@/stores/toastStore";

const mocked = aiService as unknown as { query: jest.Mock; ocr: jest.Mock };

/** The shape the axios client rejects with. */
const httpError = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { response: { status } });

const toasts = () => useToastStore.getState().toasts;

const ask = (text = "What is the interval for gauges?") => {
  fireEvent.change(screen.getByPlaceholderText(/calibration interval/i), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /ask/i }));
};

const upload = (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["%PDF"], "cert.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("A-118 — AI Assistant permission notices", () => {
  it("a 403 on the knowledge-base query shows a notice naming the permission, not an error toast", async () => {
    mocked.query.mockRejectedValue(httpError(403, "Forbidden"));
    render(<AiAssistantPage />);

    ask();

    expect(await screen.findByText(/needs read access to SOP Documents/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/calibration interval/i)).not.toBeInTheDocument();
    expect(toasts()).toEqual([]);
    // The other half still works.
    expect(screen.getByRole("button", { name: /upload certificate/i })).toBeInTheDocument();
  });

  it("a 403 on certificate OCR shows a notice naming the permission, not an error toast", async () => {
    mocked.ocr.mockRejectedValue(httpError(403, "Forbidden"));
    const { container } = render(<AiAssistantPage />);

    upload(container);

    expect(
      await screen.findByText(/needs write access to Calibration & Certificates/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload certificate|re-scan/i })).not.toBeInTheDocument();
    expect(toasts()).toEqual([]);
    expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument();
  });

  it("any other query failure is still an error toast", async () => {
    mocked.query.mockRejectedValue(httpError(500, "Server exploded"));
    render(<AiAssistantPage />);

    ask();

    await waitFor(() =>
      expect(toasts()).toEqual([
        expect.objectContaining({ type: "error", title: "Query failed", description: "Server exploded" }),
      ]),
    );
    expect(screen.queryByText(/needs read access/i)).not.toBeInTheDocument();
  });

  it("any other OCR failure is still an error toast", async () => {
    mocked.ocr.mockRejectedValue(httpError(502, "Upstream down"));
    const { container } = render(<AiAssistantPage />);

    upload(container);

    await waitFor(() =>
      expect(toasts()).toEqual([
        expect.objectContaining({ type: "error", title: "OCR failed", description: "Upstream down" }),
      ]),
    );
    expect(screen.queryByText(/needs write access/i)).not.toBeInTheDocument();
  });

  it("a permitted query shows the answer", async () => {
    mocked.query.mockResolvedValue({ answer: "Every 12 months." });
    render(<AiAssistantPage />);

    ask();

    expect(await screen.findByText("Every 12 months.")).toBeInTheDocument();
    expect(mocked.query).toHaveBeenCalledWith("What is the interval for gauges?");
  });
});

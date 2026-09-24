/** @jest-environment jsdom */
/**
 * A-89 — the QMS forms ask for the fields the database requires.
 *
 * `non_conformances.description` and `capas.action_plan` are NOT NULL and the
 * backend validator refuses them empty (qms.validator.js, A-74). The forms
 * treated both as optional and sent `undefined`, so an NC with no description
 * or a CAPA with no action plan reached the API and came back as a 400.
 * Both are now marked required and checked before the request.
 *
 * Fail-before: the labels carried no required marker, and createNonConformance
 * / createCapa were called with `description: undefined` / `actionPlan:
 * undefined`.
 *
 * Real: the page and the toast store. Mocked: the layout and the QMS client.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/services/qms.service", () => {
  const actual = jest.requireActual("@/api/services/qms.service");
  return {
    ...actual,
    qmsService: {
      listNonConformances: jest.fn(async () => ({ rows: [], total: 0, page: 1, limit: 10, totalPages: 1 })),
      listCapas: jest.fn(async () => ({ rows: [], total: 0, page: 1, limit: 10, totalPages: 1 })),
      createNonConformance: jest.fn(async () => ({ id: "nc1" })),
      createCapa: jest.fn(async () => ({ id: "c1" })),
      updateNonConformance: jest.fn(),
      updateCapa: jest.fn(),
      setRootCause: jest.fn(),
    },
  };
});

import QmsPage from "../page";
import { qmsService } from "@/api/services/qms.service";
import { useToastStore } from "@/stores/toastStore";

const mocked = qmsService as unknown as {
  createNonConformance: jest.Mock;
  createCapa: jest.Mock;
  listNonConformances: jest.Mock;
};

const toasts = () => useToastStore.getState().toasts;

/** The dialog whose heading is `title`. */
const dialog = (title: string) =>
  screen.getByRole("heading", { name: title }).closest("div.w-full") as HTMLElement;

/** The FormField labelled `label` inside `scope` — its label element and its control. */
const field = (scope: HTMLElement, label: RegExp) => {
  const labelEl = within(scope).getByText(label, { selector: "label" });
  const wrapper = labelEl.parentElement as HTMLElement;
  return {
    label: labelEl,
    control: wrapper.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement,
  };
};

const openNc = async () => {
  render(<QmsPage />);
  await waitFor(() => expect(mocked.listNonConformances).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: /raise nc/i }));
  return dialog("Raise Non-Conformance");
};

const openCapa = async () => {
  render(<QmsPage />);
  await waitFor(() => expect(mocked.listNonConformances).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "CAPAs" }));
  fireEvent.click(await screen.findByRole("button", { name: /new capa/i }));
  return dialog("New CAPA");
};

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("A-89 — Raise NC", () => {
  it("marks Description as required", async () => {
    const nc = await openNc();

    expect(field(nc, /^Description/).label).toHaveTextContent("*");
  });

  it("refuses an empty description without calling the API", async () => {
    const nc = await openNc();
    fireEvent.change(field(nc, /^Title/).control, { target: { value: "Drift" } });
    fireEvent.change(field(nc, /^Description/).control, { target: { value: "   " } });

    fireEvent.click(within(nc).getByRole("button", { name: /raise nc/i }));

    await waitFor(() =>
      expect(toasts()).toEqual([
        expect.objectContaining({ type: "error", title: "A title and a description are required" }),
      ]),
    );
    expect(mocked.createNonConformance).not.toHaveBeenCalled();
  });

  it("sends the trimmed description", async () => {
    const nc = await openNc();
    fireEvent.change(field(nc, /^Title/).control, { target: { value: " Drift " } });
    fireEvent.change(field(nc, /^Description/).control, {
      target: { value: " Reads high " },
    });

    fireEvent.click(within(nc).getByRole("button", { name: /raise nc/i }));

    await waitFor(() =>
      expect(mocked.createNonConformance).toHaveBeenCalledWith({
        title: "Drift",
        description: "Reads high",
        severity: "MEDIUM",
      }),
    );
  });
});

describe("A-89 — New CAPA", () => {
  const fill = (capa: HTMLElement, actionPlan: string) => {
    fireEvent.change(field(capa, /^Non-conformance ID/).control, {
      target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    fireEvent.change(field(capa, /^Title/).control, { target: { value: "Recalibrate" } });
    fireEvent.change(field(capa, /^Action plan/).control, { target: { value: actionPlan } });
  };

  it("marks Action plan as required", async () => {
    const capa = await openCapa();

    expect(field(capa, /^Action plan/).label).toHaveTextContent("*");
  });

  it("refuses an empty action plan without calling the API", async () => {
    const capa = await openCapa();
    fill(capa, "  ");

    fireEvent.click(within(capa).getByRole("button", { name: /create capa/i }));

    await waitFor(() =>
      expect(toasts()).toEqual([
        expect.objectContaining({
          type: "error",
          title: "An NC, a title and an action plan are required",
        }),
      ]),
    );
    expect(mocked.createCapa).not.toHaveBeenCalled();
  });

  it("sends the trimmed action plan", async () => {
    const capa = await openCapa();
    fill(capa, " Recalibrate and re-verify ");

    fireEvent.click(within(capa).getByRole("button", { name: /create capa/i }));

    await waitFor(() =>
      expect(mocked.createCapa).toHaveBeenCalledWith({
        ncId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Recalibrate",
        actionPlan: "Recalibrate and re-verify",
        dueDate: undefined,
      }),
    );
  });
});

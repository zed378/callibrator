/** @jest-environment jsdom */
/**
 * P22-07 — the dashboard page's server half: the request's locale, and only the `dashboard.` and
 * `devices.condition.` strings handed to the client island.
 */
import React from "react";
import { render } from "@testing-library/react";
import { id } from "@/i18n/messages/id";
import { createTranslator } from "@/i18n/translate";

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "id", messages: id, t: createTranslator(id) })),
}));
const island = jest.fn();
jest.mock("../DashboardClient", () => ({
  DashboardClient: () => {
    island();
    return <div>island</div>;
  },
}));
const provided = jest.fn();
jest.mock("@/i18n/MessagesProvider", () => ({
  MessagesProvider: (props: { locale: string; messages: Record<string, string>; children: React.ReactNode }) => {
    provided(props);
    return <>{props.children}</>;
  },
}));

import DashboardPage from "../page";

describe("P22-07 — /dashboard (server)", () => {
  it("hands the island its namespaces only, in the request's language", async () => {
    render(await DashboardPage());
    expect(island).toHaveBeenCalled();
    const { locale, messages } = provided.mock.calls[0]?.[0] as { locale: string; messages: Record<string, string> };
    expect(locale).toBe("id");
    expect(messages["dashboard.condition.title"]).toBe("Kondisi alat");
    expect(messages["devices.condition.good"]).toBe("Baik");
    expect(Object.keys(messages).every((k) => k.startsWith("dashboard.") || k.startsWith("devices.condition."))).toBe(true);
  });
});

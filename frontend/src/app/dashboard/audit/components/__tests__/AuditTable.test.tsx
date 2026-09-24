/**
 * A-127 / F-8 (ADR-051 Q-17) — the audit viewer names the platform operator.
 *
 * - A row written during an impersonated request carries `impersonatorId`
 *   (and `impersonator` when the reader can see that user). It shows
 *   "impersonated by <name>", or "impersonated by Platform operator" when the
 *   operator is outside the reader's tenant and the include came back null.
 * - A row whose `userId` is set but whose `user` came back null is a
 *   reference outside the tenant: "Platform operator", not "System".
 * - A row with no user at all stays "System".
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AuditTable, PLATFORM_OPERATOR, UNKNOWN_ACTOR } from "../AuditTable";
import type { AuditLog } from "@/api/services/audit.service";

const META = { total: 1, page: 1, limit: 10, totalPages: 1 };

const row = (overrides: Partial<AuditLog>): AuditLog => ({
  id: "log-1",
  tenantId: "tenant-1",
  action: "UPDATE",
  resourceType: "CalibrationDevice",
  resourceId: "dev-1",
  createdAt: "2026-09-24T10:00:00.000Z",
  ...overrides,
});

const renderRows = (logs: AuditLog[]) =>
  render(
    <AuditTable logs={logs} isLoading={false} meta={META} pageSize={10} onPageChange={() => {}} />,
  );

const member = {
  id: "u-1",
  username: "tech.one",
  firstName: "Tech",
  lastName: "One",
  email: "tech@hospital.test",
};

describe("AuditTable — who acted (A-127, F-8)", () => {
  it("shows the member and 'impersonated by <name>' when the impersonator is visible", () => {
    renderRows([
      row({
        userId: member.id,
        user: member,
        impersonatorId: "op-1",
        impersonator: { ...member, id: "op-1", username: "support.op", email: "op@platform.test" },
      }),
    ]);
    expect(screen.getByText("tech.one")).toBeInTheDocument();
    expect(screen.getByTestId("audit-impersonator")).toHaveTextContent("impersonated by support.op");
  });

  it("shows 'impersonated by Platform operator' when the impersonator reference came back null", () => {
    renderRows([row({ userId: member.id, user: member, impersonatorId: "op-1", impersonator: null })]);
    expect(screen.getByTestId("audit-impersonator")).toHaveTextContent(
      `impersonated by ${PLATFORM_OPERATOR}`,
    );
  });

  it("falls back to the impersonator's email when it has no username", () => {
    renderRows([
      row({
        userId: member.id,
        user: member,
        impersonatorId: "op-1",
        impersonator: { ...member, id: "op-1", username: "", email: "op@platform.test" },
      }),
    ]);
    expect(screen.getByTestId("audit-impersonator")).toHaveTextContent(
      "impersonated by op@platform.test",
    );
  });

  it("shows 'Platform operator', not 'System', for a set user reference that came back null", () => {
    renderRows([row({ userId: "op-1", user: null })]);
    expect(screen.getByText(PLATFORM_OPERATOR)).toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.queryByTestId("audit-impersonator")).not.toBeInTheDocument();
  });

  it("still shows 'System' for a row with no user at all", () => {
    renderRows([row({ userId: null, user: null })]);
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByText(PLATFORM_OPERATOR)).not.toBeInTheDocument();
  });

  it("an ordinary row names its user and no impersonator", () => {
    renderRows([row({ userId: member.id, user: member })]);
    expect(screen.getByText("tech.one")).toBeInTheDocument();
    expect(screen.getByText("tech@hospital.test")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-impersonator")).not.toBeInTheDocument();
  });
});

describe("AuditTable — system actors (A-124, ADR-051 Q-13)", () => {
  it("names the retention purge as a system job, with its registered name", () => {
    renderRows([
      row({ userId: null, user: null, actorType: "system", actorName: "system:retention-purge" }),
    ]);
    const cell = screen.getByTestId("audit-system-actor");
    expect(cell).toHaveTextContent("Retention purge");
    expect(cell).toHaveTextContent("system:retention-purge");
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.queryByText(PLATFORM_OPERATOR)).not.toBeInTheDocument();
  });

  it("names the tenant-lifecycle scheduler", () => {
    renderRows([
      row({ userId: null, user: null, actorType: "system", actorName: "system:tenant-lifecycle" }),
    ]);
    expect(screen.getByTestId("audit-system-actor")).toHaveTextContent("Tenant lifecycle");
  });

  it("shows a system name it has no label for as a generic job, still with the name", () => {
    renderRows([row({ userId: null, user: null, actorType: "system", actorName: "system:new-job" })]);
    const cell = screen.getByTestId("audit-system-actor");
    expect(cell).toHaveTextContent("System job");
    expect(cell).toHaveTextContent("system:new-job");
  });

  it("says a pre-migration row's actor is unknown, rather than guessing 'System'", () => {
    renderRows([row({ userId: null, user: null, actorType: "unknown", actorName: null })]);
    expect(screen.getByText(UNKNOWN_ACTOR)).toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });

  it("a user row with actorType 'user' still names the user", () => {
    renderRows([row({ userId: member.id, user: member, actorType: "user", actorName: null })]);
    expect(screen.getByText("tech.one")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-system-actor")).not.toBeInTheDocument();
  });
});

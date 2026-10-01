/** @jest-environment jsdom */
/**
 * A-299 — the create dialog offers only scopes the backend accepts.
 *
 * The backend guard (backend tests/services/apiKey.scopeContract.a299.test.ts)
 * pins @callibrator/contracts/apiKeyScopes to MENU_SLUGS and sends every
 * scope built from it through the real createApiKey. This test pins the
 * dialog to that contract: its option list is the contract's, and every
 * choice in the RENDERED dialog is a lowercase `<slug>:<read|write>`.
 *
 * Fail-before: the dialog offered "CalibrationDevices", "Certificates",
 * "Stocks", … and `*` for both resource and action — none of them a menu
 * slug (only "Vendors" lower-cased to one), so the backend answered 400.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { API_KEY_SCOPE_ACTIONS, API_KEY_SCOPE_RESOURCES } from "@callibrator/contracts/apiKeyScopes";
import { CreateApiKeyModal } from "../components/CreateApiKeyModal";
import { ACTION_OPTIONS, RESOURCE_OPTIONS, scopeLabel } from "../scopeOptions";

describe("API-key scope options (A-299)", () => {
  it("are exactly the shared contract's resources and actions", () => {
    expect(RESOURCE_OPTIONS.map((o) => o.value).sort()).toEqual([...API_KEY_SCOPE_RESOURCES].sort());
    expect(ACTION_OPTIONS.map((o) => o.value)).toEqual([...API_KEY_SCOPE_ACTIONS]);
  });

  it("labels slugs for people", () => {
    expect(scopeLabel("supplier-scorecard")).toBe("Supplier Scorecard");
    expect(scopeLabel("api-keys")).toBe("API Keys");
    expect(scopeLabel("esignature")).toBe("E-Signature");
  });

  it("the rendered dialog offers no wildcard and no name outside the contract", () => {
    const addScope = jest.fn();
    render(
      <CreateApiKeyModal
        isOpen
        onClose={jest.fn()}
        isLoading={false}
        form={{ name: "", scopes: [], expiresAt: "" }}
        setForm={jest.fn()}
        addScope={addScope}
        removeScope={jest.fn()}
        onSubmit={jest.fn()}
        createdKey={null}
        onCopyKey={jest.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Create API Key" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Scope resource" }));
    const resources = within(dialog).getAllByRole("option").map((o) => o.textContent);
    expect(resources).toHaveLength(API_KEY_SCOPE_RESOURCES.length);
    expect(resources.join(" ")).not.toMatch(/\*/);
    fireEvent.click(within(dialog).getByRole("option", { name: "QMS" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Scope action" }));
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["Read", "Write (includes read)"]);
    fireEvent.click(within(dialog).getByRole("option", { name: "Write (includes read)" }));

    fireEvent.click(within(dialog).getByRole("button", { name: /Add scope/ }));
    expect(addScope).toHaveBeenCalledWith("qms:write");
    const [scope] = addScope.mock.calls[0] as [string];
    expect(scope).toMatch(/^[a-z][a-z-]*:(read|write)$/);
  });
});

/**
 * F-12 (remainder) — the page-level overlays that were built as bare
 * `fixed inset-0` divs: no role, no name, no Escape, no focus handling.
 * They now carry role="dialog", aria-modal and aria-labelledby on their
 * panel and use useModalA11y (focus in, Tab trapped, Escape, focus restored).
 *
 * The rendered checks cover three of them; the last test is a ratchet over
 * the source tree — a grep, so it proves the markers are present, not that
 * each dialog behaves (the rendered tests and useModalA11y's own tests do).
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmationModal } from "@/app/(app)/dashboard/session-management/components/ConfirmationModal";
import { DeleteTenantModal } from "@/app/(app)/dashboard/tenants/components/DeleteTenantModal";
import { RolesDeleteConfirm } from "@/app/(app)/dashboard/roles/components/RolesDeleteConfirm";
import { axeViolations } from "@/tests/a11y/axe";

const CASES: Array<[string, (onClose: () => void) => React.ReactElement, RegExp]> = [
  [
    "session ConfirmationModal",
    (onClose) => <ConfirmationModal show type="revoke" onConfirm={() => {}} onCancel={onClose} />,
    /Revoke Session/,
  ],
  [
    "DeleteTenantModal",
    (onClose) => <DeleteTenantModal isOpen onClose={onClose} onConfirm={() => {}} />,
    /./,
  ],
  [
    "RolesDeleteConfirm",
    (onClose) => <RolesDeleteConfirm isOpen onClose={onClose} onConfirm={() => {}} isLoading={false} />,
    /./,
  ],
];

describe("page overlays are modal dialogs (F-12)", () => {
  it.each(CASES)("%s: a named modal dialog that takes focus, closes on Escape and passes axe", async (_n, make, name) => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = jest.fn();

    const { container } = render(make(onClose));

    const dialog = screen.getByRole("dialog", { name });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    opener.remove();
  });

  it("ratchet: every `fixed inset-0` overlay under src/app and src/components declares dialog semantics", () => {
    const root = path.join(__dirname, "..", "..");
    // Overlays that are not dialogs: decorative backgrounds and the mobile nav scrim.
    const NOT_DIALOGS = ["AnimatedBackground.tsx", "Sidebar.tsx", "UserDropdown.tsx"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          if (!src.includes("fixed inset-0") || NOT_DIALOGS.includes(entry.name)) continue;
          if (!/role="(alert)?dialog"|<Dialog\b|<ConfirmDialog\b|useModalA11y/.test(src)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(path.join(root, "app"));
    walk(path.join(root, "components"));
    expect(offenders).toEqual([]);
  });
});

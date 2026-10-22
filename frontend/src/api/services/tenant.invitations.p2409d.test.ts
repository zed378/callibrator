/**
 * P24-09d — tenantService.setUpstreamInvitationsOpen calls the operator's real
 * route (backend/src/routes/api/admin.route.ts: PATCH /admin/tenants/:id/flags)
 * with the one flag, and answers the tenant. A mock proves the client, not the
 * contract (CLAUDE.md): the flag's effect is asserted in
 * backend/src/tests/routes/userInvitation.p2409a.test.ts.
 */
import { tenantService } from "./tenant.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mocked = api as unknown as { patch: jest.Mock };

describe("P24-09d: tenantService.setUpstreamInvitationsOpen", () => {
  it("patches the one flag on the operator's route and answers the tenant", async () => {
    mocked.patch.mockResolvedValue({ success: true, data: { id: "t-1", settings: { upstream_invitations_open: true } } });
    const tenant = await tenantService.setUpstreamInvitationsOpen("t-1", true);
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/admin/tenants/t-1/flags", { flags: { upstream_invitations_open: true } });
    expect(tenant.settings?.["upstream_invitations_open"]).toBe(true);
  });
});

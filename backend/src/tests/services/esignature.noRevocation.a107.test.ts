/**
 * A-107 (ADR-051 A-107; ADR-055) — signature revocation does not exist
 * until it is designed as the Part 11 act it is.
 *
 * `revokeSignature` had a controller handler, a validator and a service
 * function but no route. The service half would have revoked a signature with
 * no re-authentication, no state check (a revoked signature could be revoked
 * again) and a read outside its transaction. Dead code of that shape is the
 * implementation the next person to add a route would inherit, so it is
 * removed rather than left waiting.
 *
 * These pins fail if it comes back — in any of the three layers, or as a route
 * — without the design (and the ADR) that should come with it.
 *
 * Deletion of a revoked CERTIFICATE (the other half of A-107) is refused with
 * 409 since A-130: certificate.service.test.js and eSignature.a129a130.test.js.
 */
import fs from "fs";
import path from "path";
import type * as ESignatureService from "../../services/eSignature.service";
import type * as ESignatureController from "../../controllers/eSignature.controller";
import type * as ESignatureValidator from "../../validators/eSignature.validator";

jest.mock("../../models", () => ({}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the modules are TypeScript with `export =` (ADR-087 Am. 15: no named import beside it)
const service = require("../../services/eSignature.service") as typeof ESignatureService;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the modules are TypeScript with `export =` (ADR-087 Am. 15: no named import beside it)
const controller = require("../../controllers/eSignature.controller") as typeof ESignatureController;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const validator = require("../../validators/eSignature.validator") as typeof ESignatureValidator;

describe("A-107 — no signature revocation without a design", () => {
  it("the service, the controller and the validator export no revokeSignature", () => {
    expect(service).not.toHaveProperty("revokeSignature");
    expect(controller).not.toHaveProperty("revokeSignature");
    expect(validator).not.toHaveProperty("revokeSignature");
  });

  it("no e-signature route revokes a signature", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../routes/api/eSignature.route.ts"), "utf8");
    const routeLines = source.split("\n").filter((line) => /router\.(get|post|put|patch|delete)\(/.test(line));
    const routeBlocks = source.split(/router\.(?:get|post|put|patch|delete)\(/).slice(1).map((b) => b.slice(0, 200));

    expect(routeLines.length).toBeGreaterThan(0);
    for (const block of routeBlocks) {
      expect(block).not.toMatch(/revoke/i);
    }
  });

  it("cancelling a workflow IS routed, gated and guarded (the other unrouted handler, A-130)", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../routes/api/eSignature.route.ts"), "utf8");
    const cancel = source.slice(source.indexOf('"/workflows/:workflowId/cancel"') - 40);

    expect(cancel).toMatch(/dynamicAccess\(MENU_SLUGS\.QMS, "write"\)/);
    expect(cancel.slice(0, cancel.indexOf("cancelWorkflow,") + 20)).toMatch(/validate\(cancelWorkflowValidator\)/);
  });
});

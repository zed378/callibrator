/**
 * A-78 — `checkTenant` is blind to multipart bodies.
 *
 * `dynamicAccess`'s `checkTenant` reads `req.params.tenantId`, then
 * `req.body.tenantId`, then `req.query.tenantId` (and, failing those, a
 * `userId`). On a route where `upload()` / multer runs AFTER the gate, a
 * multipart body has not been parsed when the gate runs, so a body `tenantId`
 * (or `userId`) is invisible to it and the check passes on nothing.
 *
 * This file is the enumeration the card asks for, kept as a guard: it reads
 * every router's SOURCE (the authorizationWiring scanner's helpers, so no
 * router is required) and finds every route where an upload handler follows a
 * `dynamicAccess` gate. Each one must be in REVIEWED below with the reason its
 * tenant ownership holds anyway. A new such route fails this test until
 * someone decides, in writing, why it is safe.
 *
 * The reviewed list (2026-09-24):
 *
 *   PATCH /tenants/edit            checkTenant — BLIND to the multipart
 *                                  tenantId. tenantService.updateTenant is the
 *                                  control: a non-super-admin may update only
 *                                  their own tenant, anything else is 404.
 *                                  Tests: tenant.edit.a63.test.js; and
 *                                  tenant.logo.a79.test.js › "404 (another
 *                                  tenant's id, multipart — past the gate)".
 *   POST  /tenants/:tenantId/logo  checkTenant on the PATH param, which exists
 *                                  before multer runs; the controller lets the
 *                                  path win over a body tenantId. Test:
 *                                  tenant.logo.a79.test.js › "A-78 — POST
 *                                  /tenants/:tenantId/logo".
 *   POST  /users/:userId/avatar    checkTenant on the PATH param (owner lookup);
 *                                  the service's Users.findByPk is also
 *                                  tenant-scoped by the global hooks.
 *   POST  /attachments             no checkTenant: the tenant is stamped from
 *                                  req.user.tenantId in the controller; the
 *                                  body carries only resourceType/resourceId.
 *   POST  /calibration-devices/bulk-import
 *                                  no checkTenant: tenantId is the principal's
 *                                  (req.tenantId from auth); CSV rows carry no
 *                                  tenant and the service stamps it.
 *
 * Not in the list because it is not gated at all: POST /ai/ocr (multer, auth
 * only — no dynamicAccess). Reported separately; it is a missing gate, not a
 * blind one.
 */

const fs = require("fs");
const path = require("path");
const {
  stripComments,
  readBracketed,
  splitTopLevel,
} = require("../../utils/authorizationWiring.util");

const ROUTES_DIR = path.join(__dirname, "..", "..", "routes");

/** Every `router.<verb>(path, ...handlers)` call in a source file. */
const routeCalls = (source) => {
  const clean = stripComments(source);
  const calls = [];
  const re = /\brouter\.(get|post|put|patch|delete)\s*\(/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const inner = readBracketed(clean, clean.indexOf("(", m.index));
    const args = splitTopLevel(inner).map((a) => a.trim());
    calls.push({ method: m[1].toUpperCase(), path: args[0].replace(/^["'`]|["'`]$/g, ""), args });
  }
  return calls;
};

const isUpload = (arg) => /\bupload\s*\(|\.single\s*\(|\.array\s*\(|\.fields\s*\(|\.any\s*\(/.test(arg);

/** Routes where an upload handler runs after a dynamicAccess gate. */
const uploadsAfterGate = () => {
  const out = [];
  for (const file of fs.readdirSync(path.join(ROUTES_DIR, "api"))) {
    if (!file.endsWith(".js")) {
      continue;
    }
    const source = fs.readFileSync(path.join(ROUTES_DIR, "api", file), "utf8");
    for (const call of routeCalls(source)) {
      const gate = call.args.findIndex((a) => /\bdynamicAccess\s*\(/.test(a));
      const upload = call.args.findIndex(isUpload);
      if (gate !== -1 && upload > gate) {
        out.push({
          key: `${file} ${call.method} ${call.path}`,
          checkTenant: /checkTenant\s*:\s*true/.test(call.args[gate]),
        });
      }
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
};

// key -> how tenant ownership holds although the gate cannot read the body.
const REVIEWED = {
  "attachments.route.js POST /": "no checkTenant; tenant from req.user.tenantId",
  "calibrationDevices.route.js POST /bulk-import": "no checkTenant; tenant from the principal",
  "tenant.route.js PATCH /edit": "service: tenantService.updateTenant (A-63)",
  "tenant.route.js POST /:tenantId/logo": "path param, visible to the gate",
  "user.route.js POST /:userId/avatar": "path param, visible to the gate",
};

describe("A-78 — every upload-after-gate route is enumerated and reviewed", () => {
  const found = uploadsAfterGate();

  it("the scan finds routes at all (a scan that finds nothing has not passed)", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it("every route where upload() runs after dynamicAccess is in the reviewed list — and nothing else is", () => {
    expect(found.map((r) => r.key)).toEqual(Object.keys(REVIEWED).sort());
  });

  it("a checkTenant route among them takes its tenant/owner from the PATH, or names the service that enforces it", () => {
    for (const route of found.filter((r) => r.checkTenant)) {
      const fromPath = /:(tenantId|userId)\b/.test(route.key);
      const serviceEnforced = REVIEWED[route.key].startsWith("service:");
      expect({ route: route.key, safe: fromPath || serviceEnforced }).toEqual({
        route: route.key,
        safe: true,
      });
    }
  });

  it("PATCH /tenants/edit is the only one whose gate is genuinely blind — and its create sibling is no longer gated by dynamicAccess at all (A-76)", () => {
    const blind = found.filter(
      (r) => r.checkTenant && !/:(tenantId|userId)\b/.test(r.key),
    );
    expect(blind.map((r) => r.key)).toEqual(["tenant.route.js PATCH /edit"]);
    expect(found.map((r) => r.key)).not.toContain("tenant.route.js POST /create");
  });
});

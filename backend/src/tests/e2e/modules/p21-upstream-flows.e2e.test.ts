/**
 * P21-10 — the backend flows of Phases 21–24, LIVE against a running stack (no mock: CLAUDE.md
 * § Evidence, "a mock proves the client, not the contract"). One scenario per flow, sharing what
 * the earlier ones made:
 *
 *  1. two fresh tenants, each with its administrator (the operator creates them);
 *  2. the facility scope (ADR-124): client facilities, the self facility, `/mine`, `/options`;
 *     another tenant's facility is a 404;
 *  3. the catalogue (ADR-125): a device type, an item definition, a template, its draft, the items,
 *     the publish; the published checklist read by the tenant;
 *  4. the register: a device in a client facility with its room; the warehouses filtered by facility;
 *  5. an IPM session (ADR-126): draft → results → header → submit (409 before it is complete),
 *     the report document, the `unsigned` filter before and after the performer's signature,
 *     the public verification by report number and token (404 for anything else);
 *     another tenant's session is a 404;
 *  6. the public device page (ADR-138): off by default, the minimal fields once on, never the
 *     serial or the QR; a revoked token answers the same as an unknown one;
 *  7. the upstream imports (ADR-129, ADR-130): the settings say the transform is available; a
 *     synthetic dump uploaded, scanned, parsed, loaded and transformed into the second tenant;
 *  8. the invitations (ADR-139): an imported user awaits its invitation; closed until the operator
 *     opens the tenant's switch; the invitation mailed, accepted once, then the user signs in.
 *
 * Env: BASE_URL, E2E_OPERATOR_PASSWORD (+ E2E_BOOTSTRAP_PASSWORD on a fresh stack), E2E_MAILPIT_URL.
 * Synthetic values only.
 */
import { environment } from "../../../config/env";
import { syntheticUpstreamDump } from "../../support/syntheticUpstreamDump";
import {
  apiBase,
  arr,
  call,
  dataOf,
  messageOf,
  newClientAddress,
  obj,
  operatorSession,
  roleNamed,
  runStamp,
  str,
  strongPassword,
  waitForMail,
  replaceOneTimePassword,
} from "../p10Live";

jest.setTimeout(180_000);

const penv = environment();

const stamp = runStamp();
type Reply = Awaited<ReturnType<typeof call>>;

/** The body's `data`, failing loudly with the server's words when the status is not `want`. */
const expectOk = (reply: Reply, want: number, what: string): Record<string, unknown> => {
  if (reply.status !== want) {
    throw new Error(`${what}: ${String(reply.status)} ${JSON.stringify(reply.body).slice(0, 900)}`);
  }
  return dataOf(reply);
};
const rowsOf = (reply: Reply): Record<string, unknown>[] => arr(obj(reply.body)["data"]).map(obj);
const until = async <T>(what: string, probe: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await probe();
    if (found !== null) {
      return found;
    }
    if (Date.now() > deadline) {
      throw new Error(`${what}: timed out`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

/** A complete, passing answer for one checklist item, by its input kind and its valid range. */
const completeResult = (item: Record<string, unknown>): Record<string, unknown> => {
  const content = obj(item["content"]);
  const kind = str(content["inputKind"] ?? item["inputKind"]);
  const lo = Number(content["validMin"] ?? item["validMin"] ?? NaN);
  const hi = Number(content["validMax"] ?? item["validMax"] ?? NaN);
  const value = Number.isFinite(lo) && Number.isFinite(hi) ? String((lo + hi) / 2) : Number.isFinite(lo) ? String(lo + 1) : Number.isFinite(hi) ? String(hi - 1) : "1";
  const base = { inputKind: kind, templateItemId: str(item["id"]) };
  switch (kind) {
    case "check":
      return { ...base, outcome: "done" };
    case "tri_state":
      return { ...base, outcome: "pass" };
    case "condition_clean":
      return { ...base, outcome: "good", cleanliness: "clean" };
    case "measured":
      return { ...base, value };
    case "measured_with_limit":
      return { ...base, value, outcome: "pass" };
    case "setting_measured_reference":
      return { ...base, value1: value, value2: value, outcome: "pass" };
    default:
      return { ...base, text: "baik" };
  }
};

interface Principal {
  token: string;
  tenantId: string;
  userId: string;
  email: string;
  password: string;
}

let operator = "";
const tenants: { a: Principal; b: Principal } = {
  a: { token: "", tenantId: "", userId: "", email: "", password: "" },
  b: { token: "", tenantId: "", userId: "", email: "", password: "" },
};
const made = {
  facilityA: "",
  selfA: "",
  facilityB: "",
  deviceTypeId: "",
  definitionId: "",
  templateId: "",
  versionId: "",
  templateItemId: "",
  /** The published version's items: a complete result row for each is built from its content. */
  versionItems: [] as Record<string, unknown>[],
  deviceId: "",
  deviceQr: `P21-${stamp}`.slice(0, 13).toUpperCase(),
  roomId: "",
  sessionId: "",
  reportNumber: "",
  verificationToken: "",
  publicToken: "",
};

/** A tenant with its administrator, signed in. */
const tenantWithAdmin = async (label: string, fixedCode?: string): Promise<Principal> => {
  let tenantId = "";
  if (fixedCode !== undefined) {
    // GET /admin/tenants: rows in `data`, paging in a top-level `meta` (since 2026-10-24).
    const page = await call("GET", `/admin/tenants?search=${fixedCode}&limit=100`, { token: operator });
    const found = arr(obj(page.body)["data"]).map(obj).find((t) => str(t["code"]) === fixedCode);
    tenantId = str(found?.["id"]);
  }
  if (tenantId === "") {
    const code = fixedCode ?? `P21${label}${stamp}`.slice(0, 40).toUpperCase();
    const tenant = expectOk(await call("POST", "/tenants/create", { token: operator, body: { name: `Penyedia P21 ${label} ${fixedCode ?? stamp}`, code } }), 201, "POST /tenants/create");
    tenantId = str(tenant["id"]);
  }
  const role = await roleNamed(operator, "CALIBRATOR ADMIN");
  const email = `p21-${label.toLowerCase()}-${stamp}@example.com`;
  const oneTime = strongPassword("once");
  const created = expectOk(
    await call("POST", "/users/create", {
      token: operator,
      body: { tenantId, username: `p21${label}${stamp}`.replace(/[^a-z0-9]/gi, "").slice(0, 30), firstName: "Admin", lastName: `P21 ${label}`, email, password: oneTime, roleId: role["id"] },
    }),
    201,
    "POST /users/create",
  );
  const password = strongPassword(label);
  await replaceOneTimePassword(email, oneTime, password);
  const session = await call("POST", "/auth/login", { body: { user: email, password }, from: newClientAddress() });
  const token = str(obj(session.body)["token"]) || str(dataOf(session)["token"]) || str(dataOf(session)["accessToken"]);
  if (session.status !== 200 || token === "") {
    throw new Error(`sign-in of ${email}: ${String(session.status)} ${messageOf(session)}`);
  }
  return { token, tenantId, userId: str(created["id"]), email, password };
};

beforeAll(async () => {
  operator = (await operatorSession()).token;
  tenants.a = await tenantWithAdmin("A");
  // The upstream provider: the same tenant on every run, so a re-run transforms into the tenant the id map already names.
  tenants.b = await tenantWithAdmin("B", penv["E2E_P21_PROVIDER_CODE"] ?? "P21E2EUPSTREAMPROVIDER");
});

describe("P21-10 the facility scope (ADR-124)", () => {
  test("each tenant has its self facility; an administrator adds a client facility; /mine and /options answer", async () => {
    const a = tenants.a;
    const list = rowsOf(await call("GET", "/client-facilities?limit=100", { token: a.token }));
    const self = list.find((f) => f["isSelf"] === true);
    expect(self).toBeDefined();
    made.selfA = str(self?.["id"]);
    const created = expectOk(
      await call("POST", "/client-facilities", { token: a.token, body: { name: `RS Sintetis P21 ${stamp}`, code: `RS${stamp}`.slice(0, 20).toUpperCase() } }),
      201,
      "POST /client-facilities",
    );
    made.facilityA = str(created["id"]);
    const mine = await call("GET", "/client-facilities/mine", { token: a.token });
    expect(mine.status).toBe(200);
    const options = rowsOf(await call("GET", "/client-facilities/options", { token: a.token }));
    expect(options.map((o) => str(o["id"]))).toEqual(expect.arrayContaining([made.selfA, made.facilityA]));
    expectOk(await call("GET", `/client-facilities/${made.facilityA}`, { token: a.token }), 200, "GET own facility");
    const b = rowsOf(await call("GET", "/client-facilities?limit=100", { token: tenants.b.token }));
    made.facilityB = str(b.find((f) => f["isSelf"] === true)?.["id"]);
    expect(made.facilityB).not.toBe("");
  });

  test("another tenant's facility is a 404 (never a 403), its users list too", async () => {
    for (const path of [`/client-facilities/${made.facilityA}`, `/client-facilities/${made.facilityA}/users`]) {
      const res = await call("GET", path, { token: tenants.b.token });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
  });
});

describe("P21-10 the catalogue (ADR-125)", () => {
  test("the operator adds a device type, an item, a template, its draft and items, and publishes it", async () => {
    made.deviceTypeId = str(expectOk(await call("POST", "/device-types", { token: operator, body: { name: `Pompa Sintetis P21 ${stamp}` } }), 201, "POST /device-types")["id"]);
    made.definitionId = str(
      expectOk(
        await call("POST", "/ipm/item-definitions", {
          token: operator,
          body: { content: { section: "function", label: `Alarm sintetis ${stamp}`, inputKind: "tri_state", allowedOutcomes: ["pass", "fail"] }, defaultRequired: true },
        }),
        201,
        "POST /ipm/item-definitions",
      )["id"],
    );
    made.templateId = str(expectOk(await call("POST", "/ipm/templates", { token: operator, body: { deviceTypeId: made.deviceTypeId } }), 201, "POST /ipm/templates")["id"]);
    const draft = expectOk(await call("POST", `/ipm/templates/${made.templateId}/versions`, { token: operator, body: { copyFrom: "empty" } }), 201, "POST …/versions");
    made.versionId = str(draft["id"]);
    const items = expectOk(
      await call("PUT", `/ipm/template-versions/${made.versionId}/items`, {
        token: operator,
        body: { revision: Number(draft["revision"] ?? 0), items: [{ itemDefinitionId: made.definitionId, required: true }] },
      }),
      200,
      "PUT …/items",
    );
    const published = expectOk(
      await call("POST", `/ipm/template-versions/${made.versionId}/publish`, {
        token: operator,
        body: { revision: Number(items["revision"] ?? 1), changeNote: "P21-10 e2e publish" },
      }),
      200,
      "POST …/publish",
    );
    const version = obj(published["version"]);
    expect(version["status"]).toBe("published");
    made.versionItems = arr(version["items"]).map(obj);
    made.templateItemId = str(made.versionItems.find((i) => str(obj(i["content"])["label"] ?? i["label"]).startsWith("Alarm sintetis"))?.["id"] ?? made.versionItems[0]?.["id"]);
    expect(made.templateItemId).not.toBe("");
  });

  test("the tenant reads the published checklist of the type; a tenant cannot write the catalogue", async () => {
    const read = await call("GET", "/ipm/templates/published", { token: tenants.a.token });
    const body = expectOk(read, 200, "GET /ipm/templates/published");
    expect(arr(body["deviceTypes"]).map((t) => str(obj(t)["id"]))).toContain(made.deviceTypeId);
    expect(JSON.stringify(body)).toContain(made.templateItemId);
    const denied = await call("POST", "/device-types", { token: tenants.a.token, body: { name: `Tidak boleh ${stamp}` } });
    expect(denied.status).toBe(403);
  });
});

describe("P21-10 the register and the warehouses filter", () => {
  test("a device in the client facility with a new room; the rooms filtered by facility", async () => {
    const a = tenants.a;
    const device = expectOk(
      await call("POST", "/calibration-devices", {
        token: a.token,
        body: {
          name: `Pompa Infus P21 ${stamp}`,
          serialNumber: `SN-${made.deviceQr}`,
          manufacturer: "Synthetic Medical",
          model: "SM-21",
          clientFacilityId: made.facilityA,
          deviceTypeId: made.deviceTypeId,
          qrCode: made.deviceQr,
          room: { name: `Ruang P21 ${stamp}`, floor: "2" },
        },
      }),
      201,
      "POST /calibration-devices",
    );
    made.deviceId = str(device["id"]);
    made.roomId = str(device["locationId"] ?? obj(device["room"])["id"]);
    const rooms = rowsOf(await call("GET", `/warehouses?kind=room&clientFacilityId=${made.facilityA}&limit=100`, { token: a.token }));
    expect(rooms.map((r) => str(r["name"]))).toContain(`Ruang P21 ${stamp}`);
    expect(rooms.every((r) => str(r["clientFacilityId"]) === made.facilityA)).toBe(true);
    const selfRooms = rowsOf(await call("GET", `/warehouses?kind=room&clientFacilityId=${made.selfA}&limit=100`, { token: a.token }));
    expect(selfRooms.map((r) => str(r["name"]))).not.toContain(`Ruang P21 ${stamp}`);
    const byQr = await call("GET", `/calibration-devices/by-qr/${made.deviceQr}`, { token: a.token });
    expect(byQr.status).toBe(200);
    // Another tenant: the device, its QR lookup and the facility filter answer nothing of tenant A.
    expect((await call("GET", `/calibration-devices/${made.deviceId}`, { token: tenants.b.token })).status).toBe(404);
    expect((await call("GET", `/calibration-devices/by-qr/${made.deviceQr}`, { token: tenants.b.token })).status).toBe(404);
    expect(rowsOf(await call("GET", `/warehouses?clientFacilityId=${made.facilityA}&limit=100`, { token: tenants.b.token }))).toEqual([]);
  });
});

describe("P21-10 an IPM session (ADR-126): draft, results, submit, report, signature, verify", () => {
  test("a draft for the device on its published checklist; submit refuses an incomplete one with a state explanation", async () => {
    const a = tenants.a;
    const session = expectOk(await call("POST", "/ipm/sessions", { token: a.token, body: { deviceId: made.deviceId } }), 201, "POST /ipm/sessions");
    made.sessionId = str(session["id"]);
    expect(session["status"]).toBe("draft");
    const early = await call("POST", `/ipm/sessions/${made.sessionId}/submit`, { token: a.token, body: { revision: Number(session["revision"] ?? 0) } });
    // An incomplete draft is a content problem, named item by item (400), not a state conflict.
    expect(early.status).toBe(400);
    expect(messageOf(early)).toMatch(/cannot be submitted yet/);
  });

  test("results and header, then submit: a report number and a verification token", async () => {
    const a = tenants.a;
    const current = expectOk(await call("GET", `/ipm/sessions/${made.sessionId}`, { token: a.token }), 200, "GET session");
    const withResults = expectOk(
      await call("PUT", `/ipm/sessions/${made.sessionId}/results`, {
        token: a.token,
        body: { revision: Number(current["revision"] ?? 0), results: made.versionItems.map(completeResult) },
      }),
      200,
      "PUT results",
    );
    const header = expectOk(
      await call("PATCH", `/ipm/sessions/${made.sessionId}`, {
        token: a.token,
        body: { revision: Number(withResults["revision"] ?? 1), inspectionOutcome: "pass", maintenanceOutcome: "pass", recommendation: "fit_for_use", notes: "P21-10 sintetis" },
      }),
      200,
      "PATCH header",
    );
    const submitted = expectOk(await call("POST", `/ipm/sessions/${made.sessionId}/submit`, { token: a.token, body: { revision: Number(header["revision"] ?? 2) } }), 200, "submit");
    expect(submitted["status"]).toBe("submitted");
    made.reportNumber = str(submitted["reportNumber"]);
    expect(made.reportNumber).not.toBe("");
  });

  test("the report document; the unsigned filter lists it until the performer signs (password re-entered)", async () => {
    const a = tenants.a;
    const doc = expectOk(await call("GET", `/ipm/sessions/${made.sessionId}/report-document`, { token: a.token }), 200, "GET report-document");
    expect(JSON.stringify(doc)).toContain(made.reportNumber);
    // The issued document carries the verification link the QR prints (the token only there).
    const link = /[?&]t(?:oken)?=([A-Za-z0-9_%-]+)/.exec(JSON.stringify(doc));
    made.verificationToken = decodeURIComponent(link?.[1] ?? "");
    expect(made.verificationToken).not.toBe("");
    const unsigned = rowsOf(await call("GET", "/ipm/sessions?unsigned=true&limit=100", { token: a.token })).map((s) => str(s["id"]));
    expect(unsigned).toContain(made.sessionId);
    const wrong = await call("POST", `/ipm/sessions/${made.sessionId}/signatures`, {
      token: a.token,
      body: { kind: "performer", authMethod: "password", authPayload: "not-the-password", meaningAcknowledged: true },
    });
    expect([401, 403]).toContain(wrong.status);
    expectOk(
      await call("POST", `/ipm/sessions/${made.sessionId}/signatures`, {
        token: a.token,
        body: { kind: "performer", authMethod: "password", authPayload: a.password, meaningAcknowledged: true },
      }),
      201,
      "POST signatures",
    );
    const after = rowsOf(await call("GET", "/ipm/sessions?unsigned=true&limit=100", { token: a.token })).map((s) => str(s["id"]));
    expect(after).not.toContain(made.sessionId);
    const signed = rowsOf(await call("GET", "/ipm/sessions?unsigned=false&limit=100", { token: a.token })).map((s) => str(s["id"]));
    expect(signed).toContain(made.sessionId);
  });

  test("the public verification answers the report by number and token, and the same 404 for anything else", async () => {
    const ok = await call("GET", `/ipm/verify/${encodeURIComponent(made.reportNumber)}?token=${encodeURIComponent(made.verificationToken)}`, { from: newClientAddress() });
    expect(ok.status).toBe(200);
    const unknown = await call("GET", `/ipm/verify/${encodeURIComponent(`${made.reportNumber}9`)}?token=${encodeURIComponent(made.verificationToken)}`, { from: newClientAddress() });
    const badToken = await call("GET", `/ipm/verify/${encodeURIComponent(made.reportNumber)}?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, { from: newClientAddress() });
    expect([unknown.status, badToken.status]).toEqual([404, 404]);
    expect(messageOf(unknown)).toBe(messageOf(badToken));
  });

  test("another tenant's session, report and signature are 404; its list holds none of them", async () => {
    const b = tenants.b;
    for (const [method, path, body] of [
      ["GET", `/ipm/sessions/${made.sessionId}`, undefined],
      ["GET", `/ipm/sessions/${made.sessionId}/report-document`, undefined],
      ["POST", `/ipm/sessions/${made.sessionId}/void`, { reason: "cross-tenant probe" }],
      ["POST", `/ipm/sessions/${made.sessionId}/signatures`, { kind: "countersign", authMethod: "password", authPayload: b.password, meaningAcknowledged: true }],
    ] as const) {
      const res = await call(method, path, { token: b.token, ...(body ? { body } : {}) });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    expect(rowsOf(await call("GET", "/ipm/sessions?limit=100", { token: b.token })).map((s) => str(s["id"]))).not.toContain(made.sessionId);
  });
});

describe("P21-10 the public device page (ADR-138)", () => {
  test("a token is issued; the page is off until the tenant turns it on; then minimal, never the serial or the QR", async () => {
    const a = tenants.a;
    const issued = expectOk(await call("POST", `/calibration-devices/${made.deviceId}/public-token`, { token: a.token, body: {} }), 201, "issue public token");
    made.publicToken = str(issued["token"]);
    expect(made.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const off = await call("GET", `/public/devices/${made.publicToken}`, { from: newClientAddress() });
    const settings = await call("PATCH", "/tenants/settings", { token: a.token, body: { tenantId: a.tenantId, public_device_page: "minimal" } });
    expect(settings.status).toBe(200);
    const on = await call("GET", `/public/devices/${made.publicToken}`, { from: newClientAddress() });
    expect(on.status).toBe(200);
    const shown = JSON.stringify(on.body);
    expect(shown).toContain(`Pompa Infus P21 ${stamp}`);
    expect(shown).not.toContain(`SN-${made.deviceQr}`);
    expect(shown).not.toContain(made.deviceQr);
    expect(shown).not.toContain(`Ruang P21 ${stamp}`);
    // Off: the same 404 an unknown token gets (the page renders it as "no device answers").
    expect(off.status).toBe(404);
    expect(JSON.stringify(off.body)).not.toContain(`Pompa Infus P21 ${stamp}`);
  });

  test("a revoked token and an unknown one give the same answer; another tenant cannot manage the token", async () => {
    expect((await call("DELETE", `/calibration-devices/${made.deviceId}/public-token`, { token: tenants.b.token })).status).toBe(404);
    expectOk(await call("DELETE", `/calibration-devices/${made.deviceId}/public-token`, { token: tenants.a.token }), 200, "revoke");
    const revoked = await call("GET", `/public/devices/${made.publicToken}`, { from: newClientAddress() });
    const unknown = await call("GET", "/public/devices/AAAAAAAAAAAAAAAAAAAAAA", { from: newClientAddress() });
    expect(revoked.status).toBe(unknown.status);
    expect(obj(revoked.body)["data"]).toEqual(obj(unknown.body)["data"]);
    expect(messageOf(revoked)).toBe(messageOf(unknown));
  });
});

describe("P21-10 the upstream imports and the invitations (ADR-129, ADR-130, ADR-139)", () => {
  let runId = "";
  let importedUserId = "";
  let importedEmail = "";

  test("the settings say the transform is available; the image import names its classes", async () => {
    const settings = expectOk(await call("GET", "/admin/upstream-sql-imports/settings", { token: operator }), 200, "settings");
    expect(settings["transformAvailable"]).toBe(true);
    expect(settings["realDataAllowed"]).toBe(false);
    expect((await call("GET", "/admin/upstream-file-imports/config", { token: operator })).status).toBe(200);
    expect((await call("GET", "/admin/upstream-sql-imports", { token: tenants.a.token })).status).toBe(403);
  });

  test("a synthetic dump is uploaded, loaded, and transformed into tenant B", async () => {
    const dump = syntheticUpstreamDump({ facilities: 3, devices: 6, rowsPerInsert: 10 });
    const form = new FormData();
    form.append("dataClass", "synthetic");
    form.append("file", new Blob([dump.sql], { type: "application/sql" }), "skp_ipm_synthetic.sql");
    const res = await fetch(`${apiBase()}/admin/upstream-sql-imports`, { method: "POST", headers: { Authorization: `Bearer ${operator}` }, body: form });
    const body = obj(await res.json());
    if (res.status !== 202 && res.status !== 201) {
      throw new Error(`upload: ${String(res.status)} ${str(body["message"])}`);
    }
    runId = str(obj(body["data"])["id"]);
    const loaded = await until("the run loads", async () => {
      const run = dataOf(await call("GET", `/admin/upstream-sql-imports/${runId}`, { token: operator }));
      if (run["status"] === "failed" || run["status"] === "cancelled") {
        throw new Error(`the run ended ${str(run["status"])}: ${str(run["errorCode"])}`);
      }
      return run["status"] === "loaded" ? run : null;
    });
    expect(loaded["transformRequestable"]).toBe(true);
    const requested = await call("POST", `/admin/upstream-sql-imports/${runId}/transform`, { token: operator, body: { providerTenantId: tenants.b.tenantId } });
    expect(requested.status).toBe(200);
    const done = await until("the transform ends", async () => {
      const run = dataOf(await call("GET", `/admin/upstream-sql-imports/${runId}`, { token: operator }));
      return run["transformStatus"] === "transformed" || run["transformStatus"] === "transform_failed" ? run : null;
    }, 300_000);
    expect({ status: done["transformStatus"], code: done["transformErrorCode"] ?? null }).toEqual({ status: "transformed", code: null });
    const steps = arr(obj(done["transformSummary"])["steps"]).map((s) => str(obj(s)["step"]));
    expect(steps).toHaveLength(13);
  });

  test("an imported user awaits its invitation: closed until the operator opens the switch, then mailed, accepted once, signed in", async () => {
    const b = tenants.b;
    // The list does not say who awaits an invitation; each account's invitation state does.
    const users = rowsOf(await call("GET", "/users/all?limit=100", { token: b.token }));
    let imported: Record<string, unknown> | undefined;
    for (const user of users) {
      const state = dataOf(await call("GET", `/users/${str(user["id"])}/invitation`, { token: b.token }));
      if (state["awaitingInvitation"] === true && state["live"] === null) {
        imported = { ...user, personRequired: state["personRequired"] };
        break;
      }
    }
    expect(imported).toBeDefined();
    importedUserId = str(imported?.["id"]);
    importedEmail = str(imported?.["email"]);
    const closed = await call("POST", `/users/${importedUserId}/invitation`, { token: b.token, body: {} });
    expect(closed.status).toBe(409);
    expect((await call("POST", `/users/${importedUserId}/invitation`, { token: tenants.a.token, body: {} })).status).toBe(404);
    expectOk(await call("PATCH", `/admin/tenants/${b.tenantId}/flags`, { token: operator, body: { flags: { upstream_invitations_open: true } } }), 200, "open the switch");
    const since = Date.now();
    const shared = imported?.["personRequired"] === true;
    const issued = await call("POST", `/users/${importedUserId}/invitation`, { token: b.token, body: shared ? { firstName: "Teknisi", lastName: "Sintetis" } : {} });
    expect([200, 201]).toContain(issued.status);
    const mail = await waitForMail(importedEmail, /token=([A-Za-z0-9_-]{20,})/, since);
    const invitationToken = mail[1] ?? "";
    const password = strongPassword("invited");
    const accepted = await call("POST", "/auth/invitation/accept", { body: { token: invitationToken, password }, from: newClientAddress() });
    expect(accepted.status).toBe(200);
    const again = await call("POST", "/auth/invitation/accept", { body: { token: invitationToken, password }, from: newClientAddress() });
    expect(again.status).not.toBe(200);
    const signIn = await call("POST", "/auth/login", { body: { user: importedEmail, password }, from: newClientAddress() });
    expect(signIn.status).toBe(200);
  });

  afterAll(async () => {
    await call("PATCH", `/admin/tenants/${tenants.b.tenantId}/flags`, { token: operator, body: { flags: { upstream_invitations_open: false } } }).catch(() => undefined);
  });
});

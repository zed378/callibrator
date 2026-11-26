/** PT-17: real multipart photo + local HTTP exposure; synthetic disposable stack only. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { environment } from "../../../config/env";
import { jpeg } from "../../fixtures/photoFixtures";
import { apiBase, call, dataOf, newClientAddress, obj, operatorSession, replaceOneTimePassword, roleNamed, runStamp, str, strongPassword } from "../p10Live";

jest.setTimeout(180_000);
const exec = promisify(execFile);
const vars = environment();
const stamp = runStamp();
const canary = `LEGACY-PRIVATE-${stamp}`;
const original = `${canary}-<img src=x onerror=alert(1707)>.jpg`;
let token = "";
let tenant = "";
let facility = "";
let device = "";
let attachment = "";
let key = "";
let signed = "";
const seen: string[] = [];
const ok = (reply: Awaited<ReturnType<typeof call>>, status: number): Record<string, unknown> => {
  expect({ status: reply.status, body: reply.status === status ? null : reply.body }).toEqual({ status, body: null });
  seen.push(JSON.stringify(reply.body));
  return dataOf(reply);
};
const absolute = (url: string): string => new URL(url, `${apiBase().replace(/\/api\/v1$/, "")}/`).toString();

beforeAll(async () => {
  const container = vars["E2E_POSTGRES_CONTAINER"] ?? "";
  if (!/^callibrator-p17-20261125-postgres-1$/.test(container)) {
    throw new Error("PT17 photo evidence requires the named synthetic disposable p17 PostgreSQL container");
  }
  const operator = (await operatorSession()).token;
  tenant = str(ok(await call("POST", "/tenants/create", { token: operator, body: { name: `PT17 photo ${stamp}`, code: `PS${stamp}`.toUpperCase() } }), 201)["id"]);
  const role = await roleNamed(operator, "CALIBRATOR ADMIN");
  const email = `pt17photo-${stamp}@example.test`;
  const once = strongPassword("photoOnce");
  ok(await call("POST", "/users/create", { token: operator, body: { tenantId: tenant, username: `ps${stamp}`.slice(0, 30), firstName: "Synthetic", lastName: "Photo", email, password: once, roleId: role["id"] } }), 201);
  const password = strongPassword("photoReady");
  await replaceOneTimePassword(email, once, password);
  const login = await call("POST", "/auth/login", { body: { user: email, password }, from: newClientAddress() });
  expect(login.status).toBe(200);
  token = str(obj(login.body)["token"]);
  expect(token).not.toBe("");
  facility = str(ok(await call("POST", "/client-facilities", { token, body: { name: `Photo F1 ${stamp}`, code: `P${stamp}`.toUpperCase() } }), 201)["id"]);
  device = str(ok(await call("POST", "/calibration-devices", { token, body: { name: `Photo device ${stamp}`, serialNumber: canary, clientFacilityId: facility, qrCode: `P${stamp}`.slice(0, 13).toUpperCase(), room: { name: `Photo room ${stamp}` } } }), 201)["id"]);
  seen.length = 0; // The device response legitimately names its own serial. Photo metadata must not.
});

test("multipart filename is discarded; photo reads and audit do not expose its identity or object key", async () => {
  const logStart = new Date().toISOString();
  const form = new FormData();
  form.append("purpose", "device_front");
  form.append("file", new Blob([new Uint8Array(jpeg(40, 30))], { type: "image/jpeg" }), original);
  const upload = await fetch(`${apiBase()}/calibration-devices/${device}/photos`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": randomUUID() }, body: form });
  const body: unknown = await upload.json();
  expect({ status: upload.status, body: upload.status === 201 ? null : body }).toEqual({ status: 201, body: null });
  seen.push(JSON.stringify(body));
  attachment = str(obj(obj(body)["data"])["id"]);
  expect(attachment).toMatch(/^[a-f0-9-]{36}$/);
  const db = await exec("docker", ["exec", vars["E2E_POSTGRES_CONTAINER"] ?? "", "psql", "-U", vars["E2E_POSTGRES_USER"] ?? "callibrator", "-d", vars["E2E_POSTGRES_DB"] ?? "callibrator", "-v", "ON_ERROR_STOP=1", "-At", "-c", `SELECT json_build_object('key',storage_key,'fileName',file_name,'originalName',original_name)::text FROM attachments WHERE tenant_id='${tenant}' AND id='${attachment}'`]);
  const stored = obj(JSON.parse(db.stdout.trim()) as unknown);
  key = str(stored["key"]);
  expect(key).toMatch(new RegExp(`^t/${tenant}/f/${facility}/attachments/[a-f0-9-]+\\.jpg$`));
  expect(stored["originalName"]).toBe("device_front.jpg");
  expect(JSON.stringify(stored)).not.toContain(canary);
  expect(JSON.stringify(stored)).not.toContain("onerror");
  ok(await call("GET", `/attachments/${attachment}`, { token }), 200);
  const link = ok(await call("POST", `/attachments/${attachment}/signed-url`, { token, body: {} }), 200);
  signed = str(link["url"]);
  expect(signed).not.toBe("");
  for (const payload of seen) {
    expect(payload).not.toContain(key);
    expect(payload).not.toMatch(/storageKey|storage_key|onerror/);
    expect(payload).not.toContain(canary);
  }
  const audit = await exec("docker", ["exec", vars["E2E_POSTGRES_CONTAINER"] ?? "", "psql", "-U", vars["E2E_POSTGRES_USER"] ?? "callibrator", "-d", vars["E2E_POSTGRES_DB"] ?? "callibrator", "-v", "ON_ERROR_STOP=1", "-At", "-c", `SELECT changes::text FROM audit_logs WHERE tenant_id='${tenant}' AND resource_id='${attachment}'`]);
  expect(audit.stdout.trim()).not.toBe("");
  expect(audit.stdout).not.toContain(canary);
  expect(audit.stdout).not.toContain("onerror");
  expect(audit.stdout).not.toContain(key);
  const logs = await exec("docker", ["logs", "--since", logStart, "callibrator-p17-20261125-backend-1"]);
  for (const stream of [logs.stdout, logs.stderr]) {
    expect(stream).not.toContain(canary);
    expect(stream).not.toContain("onerror=alert(1707)");
    expect(stream).not.toContain(key);
  }
});

test("the signed photo is real JPEG; anonymous local object-key and legacy paths cannot return it", async () => {
  expect(key).not.toBe("");
  const positive = await fetch(absolute(signed), { redirect: "manual" });
  expect(positive.status).toBe(200);
  expect(positive.headers.get("content-type")).toMatch(/^image\/jpeg/);
  const bytes = new Uint8Array(await positive.arrayBuffer());
  expect(Array.from(bytes.slice(0, 3))).toEqual([255, 216, 255]);
  for (const path of [
    `/api/v1/storage/object?key=${encodeURIComponent(key)}`,
    `/api/v1/storage/object?key=${encodeURIComponent(key)}&token=invalid`,
    `/uploads/${key}`,
    `/uploads/attachments/${key.split("/").pop() ?? ""}`,
    `/storage/${key}`,
    `/api/v1/attachments/${attachment}/download`,
  ]) {
    const reply = await fetch(absolute(path), { redirect: "manual" });
    expect({ path, denied: reply.status >= 400 }).toEqual({ path, denied: true });
    expect(reply.headers.get("content-type") ?? "").not.toMatch(/^image\//);
  }
});

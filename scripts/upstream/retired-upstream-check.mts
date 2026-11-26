/** P28-03: real HTTP proof on an isolated nginx; no upstream application is contacted. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "callibrator-retirement-"));
const container = "callibrator-retirement-" + Date.now();
const docker = (...args: string[]): string => execFileSync("docker", args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();
let started = false;
try {
  for (const [source, target] of [
    ["retired-upstream.conf.template", "default.conf"],
    ["retired-upstream.html.template", "retired.html"],
    ["legacy-stickers.notice.html.template", "notice.html"],
  ]) {
    writeFileSync(path.join(scratch, target!), readFileSync("deploy/compose/nginx/" + source, "utf8")
      .replaceAll("${APP_ORIGIN}", "https://app.example.test").replaceAll("${LEGACY_HOST}", "legacy.example.test"));
  }
  const mounts = ["--mount", "type=bind,src=" + path.join(scratch, "default.conf") + ",dst=/etc/nginx/conf.d/default.conf,readonly",
    "--mount", "type=bind,src=" + scratch + ",dst=/usr/share/nginx/html/legacy-stickers,readonly"];
  docker("run", "--rm", ...mounts, "nginx:stable-bookworm", "nginx", "-t");
  docker("run", "-d", "--name", container, "-p", "127.0.0.1::80", ...mounts, "nginx:stable-bookworm");
  started = true;
  const base = "http://127.0.0.1:" + docker("port", container, "80/tcp").split(":").at(-1);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(base)).status === 410) { ready = true; break; } } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "retirement server did not start");
  for (const pathname of ["/", "/api/login", "/api_v1/loginUser", "/api/v1/devices", "/public/client.apk", "/info.php", "/ipm/pdf_ipm/123"]) {
    for (const method of ["GET", "POST"]) {
      const reply = await fetch(base + pathname, { method, redirect: "error" });
      assert.equal(reply.status, 410, method + " " + pathname);
      assert.equal(reply.headers.get("cache-control"), "no-store");
      assert.equal(reply.headers.get("referrer-policy"), "no-referrer");
      assert.match(reply.headers.get("content-security-policy") ?? "", /default-src 'none'/);
      const body = await reply.text();
      assert.match(body, /Aplikasi lama telah dihentikan/);
      assert.match(body, /href="https:\/\/app\.example\.test\/login"/);
    }
  }
  const sticker = await fetch(base + "/readQr/QR000123");
  assert.equal(sticker.status, 200);
  assert.match(await sticker.text(), /%3Fqr%3DQR000123/);
  assert.equal((await fetch(base + "/readQr/%3Cscript%3E")).status, 410);
  assert.equal((await fetch(base + "/retired.html")).status, 404, "internal error document is not a public application path");
  console.log("P28-03 nginx retirement: GET/POST application/API/APK 410, privacy headers, legacy notice PASS");
} finally {
  if (started) docker("rm", "-f", container);
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()));
  assert.ok(path.basename(scratch).startsWith("callibrator-retirement-"));
  rmSync(scratch, { recursive: true, force: true });
}

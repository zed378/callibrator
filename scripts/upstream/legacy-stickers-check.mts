/**
 * P27-02: render the legacy notice on a disposable nginx and prove its HTTP boundary.
 * Synthetic domains/codes only. Run: node scripts/upstream/legacy-stickers-check.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "callibrator-legacy-stickers-"));
const container = "callibrator-legacy-stickers-" + Date.now();
const appOrigin = "https://app.example.test";
const render = (file: string): string =>
  readFileSync(file, "utf8").replaceAll("${LEGACY_HOST}", "legacy.example.test").replaceAll("${APP_ORIGIN}", appOrigin);
const docker = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let started = false;

try {
  const config = path.join(scratch, "default.conf");
  const html = path.join(scratch, "notice.html");
  writeFileSync(config, render("deploy/compose/nginx/legacy-stickers.conf.template"));
  writeFileSync(html, render("deploy/compose/nginx/legacy-stickers.notice.html.template"));
  const mounts = [
    "--mount", "type=bind,src=" + config + ",dst=/etc/nginx/conf.d/default.conf,readonly",
    "--mount", "type=bind,src=" + html + ",dst=/usr/share/nginx/html/legacy-stickers/notice.html,readonly",
  ];
  docker("run", "--rm", ...mounts, "nginx:stable-bookworm", "nginx", "-t");
  docker("run", "-d", "--name", container, "-p", "127.0.0.1::80", ...mounts, "nginx:stable-bookworm");
  started = true;
  const port = docker("port", container, "80/tcp").split(":").at(-1);
  assert.match(port ?? "", /^\d+$/);
  const base = "http://127.0.0.1:" + port;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const reply = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (reply.status === 200) { ready = true; break; }
    } catch { /* nginx may still be starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "nginx did not become ready");
  const bodies: string[] = [];
  for (const code of ["QR000123", "UNKNOWN999"]) {
    const reply = await fetch(base + "/readQr/" + code);
    assert.equal(reply.status, 200);
    assert.equal(reply.headers.get("cache-control"), "no-store");
    assert.equal(reply.headers.get("referrer-policy"), "no-referrer");
    assert.match(reply.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(reply.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const body = await reply.text();
    assert.match(body, /Stiker ini telah diganti/);
    assert.match(body, /This sticker has been replaced/);
    assert.doesNotMatch(body, /__STICKER__|<script|<img|serialNumber|tenantId|clientFacilityId/);
    const href = /href="([^"]+)"/.exec(body)?.[1];
    const login = new URL(href ?? "");
    assert.equal(login.origin, appOrigin);
    assert.equal(login.pathname, "/login");
    assert.equal(login.searchParams.get("callbackUrl"), "/dashboard/ipm/new?qr=" + code);
    bodies.push(body.replaceAll(code, "CODE"));
  }
  assert.equal(bodies[0], bodies[1], "known-shaped and unknown stickers reveal the same notice");
    const spoofed = await fetch(base + "/readQr/QR000123?callbackUrl=https://attacker.example", {
      headers: { Host: "attacker.example", "X-Forwarded-Host": "attacker.example" },
    });
    assert.equal(spoofed.status, 200);
    const spoofedBody = await spoofed.text();
    assert.doesNotMatch(spoofedBody, /attacker\.example/);
    assert.match(spoofedBody, /href="https:\/\/app\.example\.test\/login\?/);
  const fallback = await fetch(base + "/not-a-legacy-code");
  assert.equal(fallback.status, 200);
  assert.doesNotMatch(await fallback.text(), /__STICKER__/);
  const statuses = await Promise.all(Array.from({ length: 20 }, async () =>
    (await fetch(base + "/readQr/QR000123")).status));
  assert.ok(statuses.includes(429), "the legacy host must enforce its request budget");
  console.log("P27-02 legacy nginx: syntax, notice, callback, headers, non-enumeration and rate limit PASS");
} finally {
  if (started) { docker("rm", "-f", container); }
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()));
  assert.ok(path.basename(scratch).startsWith("callibrator-legacy-stickers-"));
  rmSync(scratch, { recursive: true, force: true });
}

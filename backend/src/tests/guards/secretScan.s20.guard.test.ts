/**
 * S-20 (ADR-100 Amendment 4) — the response scanner itself: it finds a
 * credential key and a password-hash-shaped value anywhere in a body, allows
 * a one-time secret only on its named routes, and the real-Express patch
 * (tests/setup/secretScan.setup.ts) records what a route serialises.
 */
import express from "express";
import * as http from "http";
import type { AddressInfo } from "net";
import { findSecrets, secretsMessage, SECRET_KEYS } from "../support/secretScan";
import { takePendingFindings } from "../setup/secretScan.setup";

const BCRYPT = `$2a$10$${"b".repeat(53)}`;

describe("findSecrets", () => {
  it("a credential key, nested or in an array, and its snake_case column", () => {
    expect(findSecrets({ data: [{ user: { password: "x" } }], meta: {} }).map((f) => f.path)).toEqual(["data[0].user.password"]);
    expect(findSecrets({ token_hash: "t" })).toEqual([{ path: "token_hash", kind: "key", detail: "token_hash" }]);
    expect(findSecrets({ mfa_secret: "s", keyHash: "h" }).map((f) => f.detail)).toEqual(["mfa_secret", "keyHash"]);
  });

  it("a password hash under ANY key, and argon2", () => {
    expect(findSecrets({ note: BCRYPT })).toEqual([{ path: "note", kind: "hash", detail: "$2a$10$…" }]);
    expect(findSecrets(["$argon2id$v=19$m=65536"])[0]?.kind).toBe("hash");
  });

  it("null, undefined and [REDACTED] values are not findings; nor are ordinary bodies", () => {
    expect(findSecrets({ password: null, privateKey: "[REDACTED]", mfaSecret: undefined })).toEqual([]);
    expect(findSecrets({ success: true, data: { id: 1, name: "ok", mfaEnabled: true }, meta: { total: 1 } })).toEqual([]);
    expect(findSecrets("plain text")).toEqual([]);
  });

  it("a webhook's one-time secret is allowed on its routes only", () => {
    expect(findSecrets({ data: { secret: "whsec" } }, "POST /api/v1/webhooks")).toEqual([]);
    expect(findSecrets({ data: { secret: "whsec" } }, "POST /api/v1/webhooks/abc/rotate-secret")).toEqual([]);
    expect(findSecrets({ data: { secret: "whsec" } }, "GET /api/v1/webhooks")).toHaveLength(1);
    expect(findSecrets({ data: { secret: "whsec" } }, "POST /api/v1/users")).toHaveLength(1);
  });

  it("the key list covers the model redaction list", () => {
    for (const key of ["password", "mfaSecret", "mfaRecoveryCodes", "otpCode", "keyHash", "token_hash", "privateKey", "invitationTokenHash", "iotTokenHash"]) {
      expect(SECRET_KEYS.has(key)).toBe(true);
    }
  });

  it("the message names the route and every path", () => {
    expect(secretsMessage([], "GET /x")).toBeNull();
    expect(secretsMessage(findSecrets({ password: BCRYPT }), "GET /x")).toMatch(/GET \/x.*password \(credential key password\).*password \(hash-shaped value/);
  });
});

describe("the real-Express patch", () => {
  const serve = async (body: unknown): Promise<void> => {
    const app = express();
    app.get("/probe", (_req, res) => {
      res.json(body);
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    await fetch(`http://127.0.0.1:${String(port)}/probe`);
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };

  it("records a body that carries a credential (the setup fails that test in afterEach)", async () => {
    await serve({ data: { password: BCRYPT } });
    const recorded = takePendingFindings();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatch(/GET \/probe.*data\.password/);
  });

  it("records nothing for a clean body", async () => {
    await serve({ success: true, data: { id: 1 } });
    expect(takePendingFindings()).toEqual([]);
  });
});

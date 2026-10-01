/**
 * S-20 / A-331 (ADR-100 Amendment 4) — every body a REAL Express response
 * serialises in a test is scanned for credential material
 * (tests/support/secretScan.ts). A finding fails the test that produced it, in
 * `afterEach`, naming the route and the path — thrown there rather than inside
 * `res.json`, where the application's own error handler would turn it into a
 * 500 and hide it.
 *
 * Registered in jest.config.js `setupFilesAfterEnv`. The routeClient fixture
 * (fake responses) is scanned by the fixture itself.
 */
import express from "express";
import { findSecrets, secretsMessage } from "../support/secretScan";

const pending: string[] = [];

const proto = express.response as unknown as { json: (this: express.Response, body?: unknown) => express.Response };
const originalJson = proto.json;

proto.json = function scannedJson(this: express.Response, body?: unknown): express.Response {
  const req = this.req as express.Request | undefined;
  const route = `${req?.method ?? "?"} ${req?.originalUrl ?? req?.url ?? "?"}`;
  const message = secretsMessage(findSecrets(body, route), route);
  if (message) {
    pending.push(message);
  }
  return originalJson.call(this, body);
};

/** Remove and return what the scan recorded (the guard suite proves the patch with it). */
export const takePendingFindings = (): string[] => pending.splice(0, pending.length);

afterEach(() => {
  if (pending.length > 0) {
    const messages = pending.splice(0, pending.length);
    throw new Error(messages.join("\n"));
  }
});

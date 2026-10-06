/**
 * W-10 — what a request body can be by the time a route runs.
 *
 * index.ts parses bodies with `express.json({ limit, verify })` (strict, the
 * default), then `express.urlencoded({ extended: true, limit })`, then
 * `bodyDefault`. This suite builds that same stack — the real `bodyDefault`
 * and the real `errorHandler` — sends it every body shape a client can send
 * over HTTP, and records what a route would see. It pins two facts the W-10
 * guard (guards/bodylessRequests.w10.guard.test.ts) relies on:
 *
 *  1. A route only ever sees an OBJECT or an ARRAY: no body, an unparsed
 *     content type and an empty JSON body all become `{}`; a JSON scalar or
 *     `null` and malformed JSON are refused with **400** before any route.
 *  2. index.ts still configures the stack this way (read from its source:
 *     index.ts boots the server and cannot be required here). Turning
 *     `strict` off, or moving bodyDefault before a parser, fails this test.
 */
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type * as BodyDefault from "../../middlewares/bodyDefault.middleware";
import type * as ErrorHandlers from "../../middlewares/errorHandlers.middleware";

const { bodyDefault } = jest.requireActual<typeof BodyDefault>("../../middlewares/bodyDefault.middleware");
const { errorHandler } = jest.requireActual<typeof ErrorHandlers>("../../middlewares/errorHandlers.middleware");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.ts"), "utf8");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(bodyDefault);
  app.post("/probe", (req, res) => {
    const body: unknown = req.body;
    res.status(200).json({ kind: Array.isArray(body) ? "array" : body === null ? "null" : typeof body, body });
  });
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const send = async (body: string | undefined, contentType?: string): Promise<{ status: number; json: unknown }> => {
  const headers: Record<string, string> = contentType ? { "content-type": contentType } : {};
  const res = await fetch(`${base}/probe`, { method: "POST", headers, ...(body === undefined ? {} : { body }) });
  return { status: res.status, json: await res.json() };
};

describe("W-10 — the body shapes a route can receive through index.ts's parser stack", () => {
  it.each([
    ["no body at all", undefined, undefined],
    ["an empty JSON body", "", "application/json"],
    ["a text/plain body (no parser)", "title=x", "text/plain"],
    ["an unknown content type", "<a/>", "application/xml"],
  ])("%s reaches the route as {}", async (_label, body, type) => {
    expect(await send(body, type)).toEqual({ status: 200, json: { kind: "object", body: {} } });
  });

  it("a JSON object and a JSON array reach the route as they are", async () => {
    expect(await send('{"a":1}', "application/json")).toEqual({ status: 200, json: { kind: "object", body: { a: 1 } } });
    expect(await send("[1]", "application/json")).toEqual({ status: 200, json: { kind: "array", body: [1] } });
  });

  it("a form body reaches the route as an object", async () => {
    expect(await send("title=x", "application/x-www-form-urlencoded")).toEqual({
      status: 200,
      json: { kind: "object", body: { title: "x" } },
    });
  });

  it.each([
    ["JSON null", "null"],
    ["a JSON string", '"x"'],
    ["a JSON number", "5"],
    ["a JSON boolean", "true"],
    ["malformed JSON", "{"],
  ])("%s is refused with 400 before any route runs", async (_label, body) => {
    const res = await send(body, "application/json");
    expect(res.status).toBe(400);
    expect(res.json).not.toHaveProperty("kind");
  });

  it("index.ts still parses strictly and fills the body only after both parsers", () => {
    const json = INDEX.indexOf("express.json(");
    const urlencoded = INDEX.indexOf("express.urlencoded(");
    const fill = INDEX.indexOf("app.use(bodyDefault)");
    expect([json, urlencoded, fill].every((at) => at > 0)).toBe(true);
    expect(json).toBeLessThan(urlencoded);
    expect(urlencoded).toBeLessThan(fill);
    expect(INDEX.slice(json, urlencoded)).not.toMatch(/\bstrict\s*:/);
    expect(INDEX.match(/express\.json\(/g)).toHaveLength(1);
  });
});

/**
 * fixtures/routeClient — the request double is an emitter, as a real request is.
 *
 * `uploadTimeBudget` (controllers/upstreamSqlImport) arms a 15-minute timer that calls
 * `req.emit("timeout", ms)`. routeClient's request double had no `emit` and its response double never
 * fires `close` (which is what clears that timer), so every route test that reached the middleware left
 * the timer pending. A full backend run lasts longer than 15 minutes: the timer fired inside a worker
 * that was running ANOTHER suite, which failed with "Test suite failed to run — TypeError: req.emit is
 * not a function" while all its own tests passed, and that kept the coverage gate from going green
 * (2026-11-10).
 *
 * Fail-before: without `emit` on the double, the handler below throws and the call answers 500.
 */
import type * as RouteClient from "./routeClient";
import type * as Express from "express";

const { call } = jest.requireActual<typeof RouteClient>("./routeClient");
const express = jest.requireActual<typeof Express>("express");

describe("routeClient — the request double", () => {
  it("can emit, so a timer armed by a middleware and fired later cannot throw outside any test", async () => {
    const router = express.Router();
    router.post("/probe", (req, res) => {
      req.emit("timeout", 900_000);
      res.json({ ok: true });
    });

    const reply = await call(router, "POST", "/probe");

    expect(reply.status).toBe(200);
  });
});

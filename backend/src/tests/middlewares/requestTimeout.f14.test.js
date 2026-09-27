/**
 * F-14 (ADR-074) — the backend's 408 is in the house envelope.
 *
 * index.js answered a `connect-timeout` expiry with
 * `{ status: "Error", message: "Request timeout" }`: no `success`, and a
 * `status` that is a word, not the code. The frontend's client reads both.
 *
 * It was also never reached. connect-timeout raises its error through the
 * `next` of wherever the request has got to — past the matched route — so a
 * handler mounted right after `timeout()` is behind it. A timed-out request
 * answered **503 "Response timeout"** from the final errorHandler.
 *
 * The first test builds the stack in index.js's order — `timeout()`, the
 * `req.timedout` gate, a router, notFound, this handler, the real
 * errorHandler — on a real Express app over a real socket, with the budget
 * shortened so the route outruns it.
 */
const http = require("node:http");
const express = require("express");
const timeout = require("connect-timeout");
const { requestTimeoutHandler } = require("../../middlewares/requestTimeout.middleware");
const { errorHandler } = require("../../middlewares/errorHandlers.middleware");
const { notFound } = require("../../middlewares/notFound.middleware");

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });

const get = (port, path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      })
      .on("error", reject);
  });

describe("F-14 — the request-timeout answer", () => {
  let server;
  let port;

  beforeAll(async () => {
    const app = express();
    app.use(timeout("50ms"));
    app.use((req, res, next) => {
      if (!req.timedout) {
        next();
      }
    });
    const router = express.Router();
    router.get("/slow", () => {
      // Never answers: the budget expires first.
    });
    app.use("/api/v1/reports", router);
    app.use(notFound);
    app.use(requestTimeoutHandler);
    app.use(errorHandler);
    server = await listen(app);
    port = server.address().port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("F-14: a request that outruns the budget gets a 408 in the house envelope", async () => {
    const { status, body } = await get(port, "/api/v1/reports/slow");

    expect(status).toBe(408);
    expect(body).toEqual({
      success: false,
      status: 408,
      message: "Request timeout",
      data: null,
    });
  });

  it("passes any other error on", () => {
    const next = jest.fn();
    const err = new Error("boom");

    requestTimeoutHandler(err, {}, { headersSent: false }, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it("leaves a response already under way to Express", () => {
    const next = jest.fn();
    const err = Object.assign(new Error("Response timeout"), { timeout: 30000 });
    const res = { headersSent: true, status: jest.fn() };

    requestTimeoutHandler(err, {}, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });
});

/**
 * E2E Tests: IoT ingestion module (/api/v1/iot)
 *
 * Live smoke coverage:
 *  - POST /iot/ingest — device telemetry ingestion. This is a PUBLIC endpoint
 *    authenticated by a per-device token (x-iot-token header / body.token),
 *    NOT by the bearer JWT. Without a valid device token it validates the
 *    payload and rejects with 400.
 */
const { httpPost } = require("../setup");

describe("E2E IoT (HTTP)", () => {
  test("POST /iot/ingest — 400 with an invalid/absent device token+payload", async () => {
    const { status, body } = await httpPost("/iot/ingest", { token: "bad", temp: 25 });
    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  test("POST /iot/ingest — 400 on empty body", async () => {
    const { status } = await httpPost("/iot/ingest", {});
    expect(status).toBe(400);
  });
});

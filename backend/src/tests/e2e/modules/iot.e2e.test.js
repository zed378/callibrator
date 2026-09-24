/**
 * E2E Tests: IoT ingestion module (/api/v1/iot)
 *
 * Live smoke coverage:
 *  - POST /iot/ingest — device telemetry ingestion. This is a PUBLIC endpoint
 *    authenticated by a per-device token (x-iot-token header / body.token),
 *    NOT by the bearer JWT. No token is 401; a token with no payload object is
 *    400; an unknown token is 401.
 */
const { httpPost } = require("../setup");

describe("E2E IoT (HTTP)", () => {
  test("POST /iot/ingest — 400 with an invalid/absent device token+payload", async () => {
    const { status, body } = await httpPost("/iot/ingest", { token: "bad", temp: 25 });
    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  // A-46: the token is checked first, so an empty body is a 401, not a 400.
  test("POST /iot/ingest — 401 on empty body (no token)", async () => {
    const { status } = await httpPost("/iot/ingest", {});
    expect(status).toBe(401);
  });

  // A-29: an unknown token with a well-formed payload is refused 401.
  test("POST /iot/ingest — 401 for an unknown device token", async () => {
    const { status } = await httpPost("/iot/ingest", { token: "iot_unknown", payload: { temp: 25 } });
    expect(status).toBe(401);
  });
});

/**
 * A-51 — the webhook body schemas, exercised through the real `validate()`
 * middleware (stripUnknown, abortEarly: false), because that is the only way
 * they are ever applied.
 */
const { validate } = require("../../middlewares/validation.middleware");
const {
  createWebhookSchema,
  updateWebhookSchema,
} = require("../../validators/webhook.validator");

const run = (schema, body) => {
  const req = { body };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  validate(schema)(req, res, next);
  return { req, res, next, passed: next.mock.calls.length === 1 };
};

const fieldsOf = (res) => res.json.mock.calls[0][0].details.map((e) => e.field);

describe("webhook.validator — createWebhookSchema", () => {
  const valid = { url: "https://receiver.example.com/hook", events: ["device.overdue"] };

  it("accepts a minimal valid body", () => {
    const { passed, req } = run(createWebhookSchema, valid);
    expect(passed).toBe(true);
    expect(req.body).toEqual(valid);
  });

  it("strips a caller-supplied secret instead of passing it through", () => {
    const { passed, req } = run(createWebhookSchema, { ...valid, secret: "a" });
    expect(passed).toBe(true);
    expect(req.body).not.toHaveProperty("secret");
  });

  it("strips other unknown keys (tenantId, createdBy)", () => {
    const { req } = run(createWebhookSchema, { ...valid, tenantId: "x", createdBy: "y" });
    expect(req.body).not.toHaveProperty("tenantId");
    expect(req.body).not.toHaveProperty("createdBy");
  });

  it("accepts description, isActive and the wildcard event", () => {
    const { passed } = run(createWebhookSchema, {
      url: "http://receiver.example.com/hook",
      events: ["*", "device.calibration_due"],
      description: "ops",
      isActive: false,
    });
    expect(passed).toBe(true);
  });

  it("accepts an empty or null description", () => {
    expect(run(createWebhookSchema, { ...valid, description: "" }).passed).toBe(true);
    expect(run(createWebhookSchema, { ...valid, description: null }).passed).toBe(true);
  });

  it.each([
    ["missing url", { events: ["*"] }, "url"],
    ["non-http scheme", { url: "ftp://x.example.com", events: ["*"] }, "url"],
    ["not a uri", { url: "receiver", events: ["*"] }, "url"],
    ["over-long url", { url: `https://x.example.com/${"a".repeat(1100)}`, events: ["*"] }, "url"],
    ["missing events", { url: "https://x.example.com" }, "events"],
    ["empty events", { url: "https://x.example.com", events: [] }, "events"],
    ["events not an array", { url: "https://x.example.com", events: "device.overdue" }, "events"],
    ["duplicate events", { url: "https://x.example.com", events: ["*", "*"] }, "events.1"],
    ["malformed event name", { url: "https://x.example.com", events: ["Device Overdue"] }, "events.0"],
    ["isActive not boolean", { ...valid, isActive: "yes please" }, "isActive"],
    ["over-long description", { ...valid, description: "d".repeat(256) }, "description"],
  ])("rejects %s with a 400 naming the field", (_label, body, field) => {
    const { passed, res } = run(createWebhookSchema, body);
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fieldsOf(res)).toContain(field);
  });

  it("rejects a bodyless request as a 400, not a 500", () => {
    const { passed, res } = run(createWebhookSchema, undefined);
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("webhook.validator — updateWebhookSchema", () => {
  it("accepts a partial patch", () => {
    expect(run(updateWebhookSchema, { isActive: false }).passed).toBe(true);
    expect(run(updateWebhookSchema, { url: "https://new.example.com/hook" }).passed).toBe(true);
  });

  it("strips a caller-supplied secret", () => {
    const { passed, req } = run(updateWebhookSchema, { description: "x", secret: "a" });
    expect(passed).toBe(true);
    expect(req.body).toEqual({ description: "x" });
  });

  it("rejects an empty patch", () => {
    const { passed, res } = run(updateWebhookSchema, {});
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a patch that is only a secret — it strips to nothing", () => {
    expect(run(updateWebhookSchema, { secret: "a" }).passed).toBe(false);
  });

  it("rejects an empty events array and a bad url", () => {
    expect(run(updateWebhookSchema, { events: [] }).passed).toBe(false);
    expect(run(updateWebhookSchema, { url: "javascript:alert(1)" }).passed).toBe(false);
  });
});

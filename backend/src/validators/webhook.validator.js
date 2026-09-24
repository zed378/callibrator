const Joi = require("joi");

/**
 * Webhook request bodies (A-51).
 *
 * Mounted as `validate(schema)` from `middlewares/validation.middleware.js`,
 * which runs with `stripUnknown: true` — so a caller-supplied `secret`,
 * `tenantId` or `createdBy` is removed here, before the controller sees the
 * body. The signing secret is never an input: it is generated server-side on
 * creation, on rotation and on a url change, and returned exactly once.
 *
 * The SSRF checks stay in the service (`assertSafeUrl` on write,
 * `assertResolvedHostIsPublic` before every dispatch). This schema only
 * decides the URL's shape; it does not, and cannot, decide where it resolves.
 */

// Same ceiling as `webhooks.url` (STRING(1024)).
const url = Joi.string().trim().max(1024).uri({ scheme: ["http", "https"] });

// "*" or a dotted lowercase name such as `device.overdue`. The emitter only
// ever sends lowercase names, so an uppercase or spaced subscription would be
// stored and then never fire — a silently inert webhook. Event names are NOT
// checked against a catalogue: the frontend lets an admin type a custom one,
// and the catalogue itself is A-11.
const eventName = Joi.string()
  .trim()
  .max(100)
  .pattern(/^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*)$/, "event name");

const events = Joi.array().items(eventName).min(1).max(50).unique();

const description = Joi.string().trim().max(255).allow(null, "");

exports.createWebhookSchema = Joi.object({
  url: url.required(),
  events: events.required(),
  description,
  isActive: Joi.boolean(),
});

// A patch must change something. A url change rotates the signing secret
// (see webhook.service.js#updateWebhook); the new secret is in the response.
exports.updateWebhookSchema = Joi.object({
  url,
  events,
  description,
  isActive: Joi.boolean(),
}).min(1);

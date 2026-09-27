# 00 — Integration Quickstart

The front door for an engineer connecting another system — hospital IT, a device vendor, an identity provider — to Callibrator. It names the ways in that exist, says which of them work, and sends you to the document that has the detail.

> **Target standard: TypeScript, strict (ADR-038).** The backend is **JavaScript/CommonJS** today. The documents linked here describe it **as built**.

---

## A Warning Before Anything Else

**An integration surface here can be built, tested and unreachable.** Code exists, the tests are green, and no outside party can use it — because the credential it needs cannot be issued, or a scope cannot be granted. IoT ingest was exactly that until 2026-09-24. Today the live example is the REST API itself: **calibration devices, calibration records, certificates, maintenance and reports cannot be reached by any newly issued API key** ([`02-AUTHENTICATION.md`](./02-AUTHENTICATION.md) § Scopes).

Each guide says so at its top when it applies. Believe that over a task board, a changelog or a green test run. ([`README.md`](./README.md) § A Standing Warning.)

## The Ways In

| Path | Direction | Credential | Status as built | Read |
|---|---|---|---|---|
| **REST API with an API key** | you → us | `Authorization: ApiKey cbk_…`, issued by a tenant administrator with named scopes | works for 139 of 407 routes — stock, warehouses, vendors, finance, risk, content, users, workflows and others. Deny-by-default: a key reaches nothing its scopes do not name | [`02-AUTHENTICATION.md`](./02-AUTHENTICATION.md) |
| **SCIM 2.0 provisioning** | your IdP → us | an API key with `scim:write` (`scim:read` for GET), sent as `Bearer` | reachable; SCIM bodies are wrapped in the platform envelope, which strict SCIM clients will not parse, and no SCIM mutation writes an audit row | [`09-SCIM-PROVISIONING.md`](./09-SCIM-PROVISIONING.md) |
| **Outbound webhooks** | us → your URL | an HMAC secret per webhook; `X-Webhook-Signature: v1=<HMAC-SHA256 of "<timestamp>.<body>">` | ten domain events, durable retry (12 attempts over ~20.5 h). Registering one is TENANT_ADMIN with a user session only — an API key cannot | [`../WEBHOOK/README.md`](../WEBHOOK/README.md) |
| **IoT ingest** | a device → us | a per-device token in `x-iot-token`, issued once by a tenant administrator | HTTP is provisionable since A-29 (2026-09-24) — proven by tests, **not yet exercised against a running server**. MQTT identifies a device by its topic alone, so the broker's ACLs are the only authentication (A-17) | [`07-IOT-INGEST.md`](./07-IOT-INGEST.md) |

Single sign-on into Callibrator (SAML, OIDC) is a user login, not an integration of the kinds above: [`../API/01-AUTHENTICATION-API.md`](../API/01-AUTHENTICATION-API.md).

## Your First Call With A Key

1. A **tenant administrator** signs in and calls `POST /api/v1/api-keys` with `{ "name": "…", "scopes": ["warehouse:read"] }` (or uses the API Keys page). The key is in that response **once**; only its hash is stored. Scopes are `<menu slug>:<read|write>`; `*` is refused; `write` includes `read`. Which slugs exist and which routes each opens: [`02-AUTHENTICATION.md`](./02-AUTHENTICATION.md) § Route-Module Reachability.
2. Call the API with it:

   ```http
   GET /api/v1/warehouses
   Authorization: ApiKey cbk_<56 hex characters>
   ```

3. Expect 403 rather than 404 when the key's scope does not cover a route. The message tells you which gate refused ([`02-AUTHENTICATION.md`](./02-AUTHENTICATION.md) § What A Key Sees).

Set `expiresAt` on the key. A key's scopes cannot be edited. To change them, issue a new key and revoke the old one.

## The Response Envelope, Once

Every endpoint answers `{ success, status, message, data }`. **List rows are in `data` itself; pagination is in a top-level `meta`, a sibling of `data`**, never `data.rows`, `data.items` or `data.meta`. A client that reads anything else renders an empty list with no error. The full contract, including the error shape and the status codes, is [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md). SCIM and a few limiter and timeout responses break the envelope; their guides say where.

The status codes that matter to a client, among them **404 for a row in another tenant** (never 403), **409 for a state conflict** and **429** with its wait headers, are in [`03-RATE-LIMITS-AND-ERROR-CODES.md`](./03-RATE-LIMITS-AND-ERROR-CODES.md).

## Everything In This Category

| | Guide |
|---|---|
| 00 | this page |
| 02 | [Authentication and API-Key Reach](./02-AUTHENTICATION.md) |
| 03 | [Rate Limits and Error Codes](./03-RATE-LIMITS-AND-ERROR-CODES.md) |
| 07 | [IoT Ingest](./07-IOT-INGEST.md) |
| 09 | [SCIM Provisioning](./09-SCIM-PROVISIONING.md) |
| — | [the category index](./README.md) |

Endpoint-by-endpoint contracts live in [`../API/`](../API/00-API-STANDARDS.md); the integration endpoints (keys, webhooks, SCIM, storage, attachments) are in [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md). The live OpenAPI contract is served at `/docs` (UI) and `/docs.json` (`backend/src/docs/swagger.js:41–46`) — **not in production** unless `SWAGGER_ENABLED=true` (`:30–31`, A-253). `../API/00-API-STANDARDS.md` names `/api-docs` and `/swagger.json`; the code serves neither.

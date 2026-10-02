/**
 * A-307 — webhook delivery must not resolve the host twice.
 *
 * attemptDelivery checks the registered URL with assertResolvedHostIsPublic
 * (a `dns.promises.lookup`) and then sent it with Node's `fetch`, which
 * resolved the host AGAIN to connect (`dns.lookup`). A DNS server that
 * answers public to the first and internal to the second — DNS rebinding —
 * had the backend POST a signed body into its own network.
 *
 * Here the two resolutions really do disagree: `dns.promises.lookup` says
 * 93.184.216.34, `dns.lookup` says 127.0.0.1, where a real receiver listens.
 * The SSRF util, the webhook service and the socket are REAL; only the models
 * and the claim query are doubled (as in webhook.service.test.js).
 */
import dns from "dns";
import http from "http";
import type { AddressInfo } from "net";
import { environment } from "../../config/env";

interface DeliveryRow {
  id: string;
  tenantId: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
  status?: string;
  lastError?: string | null;
  update: jest.Mock;
}

jest.mock("../../models", () => ({
  Webhook: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), findAndCountAll: jest.fn() },
  WebhookDelivery: { create: jest.fn(), findOne: jest.fn(), findAndCountAll: jest.fn() },
  AuditLog: { create: jest.fn() },
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(), query: jest.fn() },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface Models {
  Webhook: { findOne: jest.Mock };
  WebhookDelivery: { findOne: jest.Mock };
}
interface Config {
  db: { query: jest.Mock };
}
interface WebhookService {
  _dispatchDelivery(id: string, tenantId: string): Promise<DeliveryRow | null>;
}

const { Webhook, WebhookDelivery } = jest.requireMock<Models>("../../models");
const { db } = jest.requireMock<Config>("../../config");
const webhookService = jest.requireActual<WebhookService>("../../services/webhook.service");

let server: http.Server;
let port = 0;
let hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method ?? ""} ${req.url ?? ""}`);
    res.writeHead(200);
    res.end("inside");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const row = (): DeliveryRow => {
  const r: DeliveryRow = {
    id: "d1",
    tenantId: "t1",
    webhookId: "w1",
    event: "device.overdue",
    payload: {},
    attempts: 0,
    createdAt: new Date("2026-09-30T00:00:00Z"),
    update: jest.fn(),
  };
  r.update.mockImplementation((patch: Partial<DeliveryRow>) => Promise.resolve(Object.assign(r, patch)));
  return r;
};

/** Dispatch one delivery to `url` through the real service. */
const deliver = async (url: string): Promise<DeliveryRow> => {
  const delivery = row();
  db.query.mockResolvedValueOnce([{ id: "d1", tenantId: "t1" }]); // the claim (P9-18: sql() answers the rows directly)
  WebhookDelivery.findOne.mockResolvedValue(delivery);
  Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", url, secret: "s", isActive: true });
  await webhookService._dispatchDelivery("d1", "t1");
  return delivery;
};

/** The connect's resolution: the loopback receiver. */
const connectResolvesToLoopback = (): void => {
  jest.spyOn(dns, "lookup").mockImplementation(((
    _host: string,
    options: dns.LookupOptions | ((...a: unknown[]) => void),
    cb?: (err: null, address: string | dns.LookupAddress[], family?: number) => void,
  ) => {
    const callback = (typeof options === "function" ? options : cb) as (
      err: null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void;
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
    } else {
      callback(null, "127.0.0.1", 4);
    }
  }) as unknown as typeof dns.lookup);
};

describe("A-307 — webhook delivery connects to the address that was checked", () => {
  it("a host that resolves public for the check and loopback for the connect is refused; nothing reaches the socket", async () => {
    // The check's resolution: public.
    jest.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    connectResolvesToLoopback();

    const delivery = await deliver(`http://rebind.example:${String(port)}/hook`);

    expect(hits).toEqual([]);
    expect(delivery.status).toBe("failed");
    expect(delivery.lastError).toBe("SSRF guard: rebind.example resolves to a disallowed (internal) address");
  });

  it("control: the same receiver, development-allowed (never in production), is delivered to over the pinned path", async () => {
    hits = [];
    // The same two resolutions, with the host development-allowed (never in
    // production): the ONLY difference from the case above is the allow-list,
    // so the refusal above is the pinned lookup's, not a broken transport's.
    const penv = environment();
    const saved = penv["SSRF_DEV_ALLOW_HOSTS"];
    penv["SSRF_DEV_ALLOW_HOSTS"] = "rebind.example";
    jest.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    connectResolvesToLoopback();
    try {
      const delivery = await deliver(`http://rebind.example:${String(port)}/hook`);
      expect(hits).toEqual(["POST /hook"]);
      expect(delivery.status).toBe("success");
    } finally {
      if (saved === undefined) {
        Reflect.deleteProperty(penv, "SSRF_DEV_ALLOW_HOSTS");
      } else {
        penv["SSRF_DEV_ALLOW_HOSTS"] = saved;
      }
    }
  });
});

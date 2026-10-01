/**
 * A-176 — the outbound half of utils/ssrf.util: calls to TENANT-CHOSEN URLs
 * (OIDC authority, the IdP's published endpoints, ai_base_url, a tenant S3
 * endpoint).
 *
 * Before A-176 those calls went out through plain axios / the SDK default
 * agent: no check at all (OIDC, AI), or a text-only check whose hostname was
 * resolved AGAIN at connect time (S3) — a DNS-rebinding window — and axios
 * followed redirects. These tests pin what now holds:
 *
 *  - assertOutboundUrl: parse, https in production, no internal/metadata host
 *    (text), a development allow-list that production ignores;
 *  - ssrfSafeLookup: the resolver the agents CONNECT with refuses an internal
 *    answer, so the address checked is the address dialled;
 *  - ssrfSafeAxiosOptions, end to end over real sockets: a hostname resolving
 *    to loopback is refused before any byte is sent, a redirect is not
 *    followed, an oversized body is cut off.
 *
 * Expected values are written out by hand.
 */
import dns from "dns";
import http from "http";
import type { AddressInfo } from "net";
import axios from "axios";
import { environment } from "../../config/env";
import {
  assertOutboundUrl,
  pinnedFetch,
  OUTBOUND_MAX_BYTES,
  ssrfSafeAgents,
  ssrfSafeAxiosOptions,
  ssrfSafeLookup,
} from "../../utils/ssrf.util";

const penv = environment();
const saved = { nodeEnv: penv["NODE_ENV"], allow: penv["SSRF_DEV_ALLOW_HOSTS"] };

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(penv, name);
  } else {
    penv[name] = value;
  }
};

afterEach(() => {
  restore("NODE_ENV", saved.nodeEnv);
  restore("SSRF_DEV_ALLOW_HOSTS", saved.allow);
  jest.restoreAllMocks();
});

type LookupCb = (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void;

/** Make dns.lookup answer `addresses` (or fail) for every host. */
const dnsAnswers = (addresses: dns.LookupAddress[] | Error): jest.SpyInstance => {
  const impl = (_host: string, _opts: unknown, cb: LookupCb): void => {
    if (addresses instanceof Error) {
      cb(addresses, []);
    } else {
      cb(null, addresses);
    }
  };
  // dns.lookup's overloads cannot be spied with a typed implementation.
  return jest.spyOn(dns, "lookup").mockImplementation(impl as unknown as typeof dns.lookup);
};

/** Run ssrfSafeLookup and collect what it answers. */
const lookup = (
  host: string,
  options: dns.LookupOptions,
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family: unknown }> =>
  new Promise((resolve) => {
    ssrfSafeLookup(host, options, (err, address, family) => {
      resolve({ err, address, family });
    });
  });

describe("assertOutboundUrl (A-176)", () => {
  it.each([
    ["http://169.254.169.254/latest/meta-data", /ai_base_url: URL host resolves to a disallowed \(internal\) address/],
    ["http://10.0.0.5/v1", /disallowed \(internal\) address/],
    ["http://[::1]:8080/", /disallowed \(internal\) address/],
    ["http://[::ffff:169.254.169.254]/", /disallowed \(internal\) address/],
    ["http://[fd00::1]/", /disallowed \(internal\) address/],
    ["http://[::ffff:a9fe:a9fe]/", /disallowed \(internal\) address/],
    ["http://[::10.0.0.1]/", /disallowed \(internal\) address/],
    ["http://[64:ff9b::7f00:1]/", /disallowed \(internal\) address/],
    ["http://localhost:8080/", /ai_base_url: URL host is not allowed/],
    ["http://idp.local/", /URL host is not allowed/],
    ["ftp://example.com/", /URL must use http or https/],
    ["https://user:pw@example.com/", /embedded credentials/],
    ["not a url", /ai_base_url is not a valid URL/],
  ])("refuses %s with a 400 naming the setting", (url, message) => {
    let caught: unknown;
    try {
      assertOutboundUrl(url, "ai_base_url");
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 400 });
    expect((caught as Error).message).toMatch(message);
  });

  it("accepts a public https URL", () => {
    expect(assertOutboundUrl("https://api.openai.com/v1").hostname).toBe("api.openai.com");
  });

  it("accepts a public address in the hex-mapped IPv6 form", () => {
    // ::ffff:8.8.8.8 — the mapped-form check converts, it does not blanket-refuse.
    expect(assertOutboundUrl("https://[::ffff:808:808]/").hostname).toBe("[::ffff:808:808]");
  });

  it("accepts plain http outside production, refuses it in production", () => {
    penv["NODE_ENV"] = "test";
    expect(() => assertOutboundUrl("http://example.com/")).not.toThrow();
    penv["NODE_ENV"] = "production";
    expect(() => assertOutboundUrl("http://example.com/", "oidc_authority")).toThrow("oidc_authority must use https");
  });

  it("uses a default label", () => {
    expect(() => assertOutboundUrl("::")).toThrow("URL is not a valid URL");
  });

  it("lets a development-allowed internal host through outside production only", () => {
    penv["NODE_ENV"] = "development";
    penv["SSRF_DEV_ALLOW_HOSTS"] = " Localhost , 127.0.0.1,,";
    expect(assertOutboundUrl("http://localhost:8080/realms/x").port).toBe("8080");
    expect(assertOutboundUrl("http://127.0.0.1:9/").hostname).toBe("127.0.0.1");
    expect(() => assertOutboundUrl("ftp://localhost/")).toThrow("URL must use http or https");
    // Still only the named hosts.
    expect(() => assertOutboundUrl("http://10.0.0.5/")).toThrow(/disallowed/);

    penv["NODE_ENV"] = "production";
    expect(() => assertOutboundUrl("https://localhost/")).toThrow("URL host is not allowed");
  });

  it("an unset allow-list allows nothing", () => {
    penv["NODE_ENV"] = "development";
    Reflect.deleteProperty(penv, "SSRF_DEV_ALLOW_HOSTS");
    expect(() => assertOutboundUrl("http://localhost/")).toThrow("URL host is not allowed");
  });
});

describe("ssrfSafeLookup (A-176) — the resolver the connection uses", () => {
  it("refuses a host with ANY internal answer, with ESSRFBLOCKED", async () => {
    dnsAnswers([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    const { err } = await lookup("rebind.example", {});
    expect(err?.code).toBe("ESSRFBLOCKED");
    expect(err?.message).toBe("SSRF guard: rebind.example resolves to a disallowed (internal) address");
  });

  it("refuses an IPv4-mapped IPv6 answer into a private range", async () => {
    dnsAnswers([{ address: "::ffff:10.1.2.3", family: 6 }]);
    expect((await lookup("mapped.example", {})).err?.code).toBe("ESSRFBLOCKED");
  });

  it("refuses an empty answer", async () => {
    dnsAnswers([]);
    expect((await lookup("empty.example", {})).err?.code).toBe("ESSRFBLOCKED");
  });

  it("passes a resolver error through", async () => {
    const failure = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    dnsAnswers(failure);
    expect((await lookup("nx.example", {})).err).toBe(failure);
  });

  it("answers the first public address, or all of them when asked", async () => {
    const spy = dnsAnswers([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
    expect(await lookup("ok.example", {})).toEqual({ err: null, address: "93.184.216.34", family: 4 });
    expect((await lookup("ok.example", { all: true })).address).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
    // It always resolves everything, whatever the caller asked for.
    const calls = spy.mock.calls as unknown[][];
    expect(calls[0]?.[1]).toEqual({ all: true });
  });

  it("lets a development-allowed host resolve internally (never in production)", async () => {
    penv["NODE_ENV"] = "development";
    penv["SSRF_DEV_ALLOW_HOSTS"] = "keycloak";
    dnsAnswers([{ address: "172.18.0.4", family: 4 }]);
    expect((await lookup("keycloak", {})).address).toBe("172.18.0.4");
    penv["NODE_ENV"] = "production";
    expect((await lookup("keycloak", {})).err?.code).toBe("ESSRFBLOCKED");
  });
});

describe("ssrfSafeAgents / ssrfSafeAxiosOptions (A-176)", () => {
  it("builds agents that connect through ssrfSafeLookup, TLS verified", () => {
    const { httpAgent, httpsAgent } = ssrfSafeAgents();
    const options = (agent: http.Agent): Record<string, unknown> =>
      (agent as unknown as { options: Record<string, unknown> }).options;
    expect(options(httpAgent)["lookup"]).toBe(ssrfSafeLookup);
    expect(options(httpsAgent)["lookup"]).toBe(ssrfSafeLookup);
    expect(options(httpsAgent)["rejectUnauthorized"]).toBe(true);
  });

  it("refuses redirects and env proxies, and always sets a timeout and a size cap", () => {
    expect(ssrfSafeAxiosOptions({ timeoutMs: 1234 })).toMatchObject({
      maxRedirects: 0,
      proxy: false,
      timeout: 1234,
      maxContentLength: 2 * 1024 * 1024,
    });
    expect(OUTBOUND_MAX_BYTES).toBe(2097152);
    expect(ssrfSafeAxiosOptions({ timeoutMs: 1, maxBytes: 10 }).maxContentLength).toBe(10);
  });

  describe("over real sockets", () => {
    let server: http.Server;
    let port = 0;
    let hits: string[] = [];

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        hits.push(req.url ?? "");
        if (req.url === "/redirect") {
          res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
          res.end();
          return;
        }
        if (req.url === "/big") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("x".repeat(64 * 1024));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
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

    beforeEach(() => {
      hits = [];
    });

    it("a hostname that RESOLVES to loopback never reaches the socket", async () => {
      // `localhost` passes no text check here — the resolver is what refuses it.
      await expect(
        axios.get(`http://localhost:${String(port)}/`, ssrfSafeAxiosOptions({ timeoutMs: 5000 })),
      ).rejects.toMatchObject({ code: "ESSRFBLOCKED" });
      expect(hits).toEqual([]);
    });

    it("the same request without the guard DOES reach it (control)", async () => {
      const res = await axios.get(`http://localhost:${String(port)}/`, { timeout: 5000 });
      expect(res.data).toEqual({ ok: true });
      expect(hits).toEqual(["/"]);
    });

    it("a redirect is not followed", async () => {
      penv["SSRF_DEV_ALLOW_HOSTS"] = "localhost";
      await expect(
        axios.get(`http://localhost:${String(port)}/redirect`, ssrfSafeAxiosOptions({ timeoutMs: 5000 })),
      ).rejects.toMatchObject({ response: { status: 302 } });
      expect(hits).toEqual(["/redirect"]);
    });

    it("an oversized body is cut off", async () => {
      penv["SSRF_DEV_ALLOW_HOSTS"] = "localhost";
      await expect(
        axios.get(`http://localhost:${String(port)}/big`, ssrfSafeAxiosOptions({ timeoutMs: 5000, maxBytes: 1024 })),
      ).rejects.toThrow(/maxContentLength size of 1024 exceeded/);
    });
  });
});

describe("pinnedFetch (A-307) — fetch-shaped, over the pinned agents", () => {
  let server: http.Server;
  let base = "";
  let seen: { method: string; body: string; sig: string | undefined }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => {
        body += c.toString();
      });
      req.on("end", () => {
        seen.push({ method: req.method ?? "", body, sig: req.headers["x-sig"] as string | undefined });
        if (req.url === "/slow") {
          setTimeout(() => {
            res.writeHead(200);
            res.end();
          }, 2000);
          return;
        }
        if (req.url === "/moved") {
          res.writeHead(301, { Location: "http://169.254.169.254/" });
          res.end();
          return;
        }
        if (req.url === "/big") {
          res.writeHead(500);
          res.end("y".repeat(3 * 1024 * 1024)); // larger than the 2 MiB cap: never read
          return;
        }
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://localhost:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    seen = [];
    penv["SSRF_DEV_ALLOW_HOSTS"] = "localhost";
  });

  it("sends the body byte for byte, with its headers, and answers { ok, status }", async () => {
    const body = '{"b":1,  "a":"é"}'; // spacing and order a re-serialisation would change
    await expect(
      pinnedFetch(`${base}/hook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Sig": "v1=abc" }, body, timeoutMs: 5000 }),
    ).resolves.toEqual({ ok: true, status: 204 });
    expect(seen).toEqual([{ method: "POST", body, sig: "v1=abc" }]);
  });

  it("defaults to GET", async () => {
    await pinnedFetch(`${base}/`, { timeoutMs: 5000 });
    expect(seen[0]?.method).toBe("GET");
  });

  it("returns a 3xx unfollowed, and a 5xx without throwing or reading its body", async () => {
    await expect(pinnedFetch(`${base}/moved`, { timeoutMs: 5000 })).resolves.toEqual({ ok: false, status: 301 });
    await expect(pinnedFetch(`${base}/big`, { timeoutMs: 5000 })).resolves.toEqual({ ok: false, status: 500 });
    expect(seen.map((s) => s.method)).toEqual(["GET", "GET"]);
  });

  it("an aborted signal and a timeout both reject as AbortError", async () => {
    const controller = new AbortController();
    const pending = pinnedFetch(`${base}/slow`, { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(pinnedFetch(`${base}/slow`, { timeoutMs: 100 })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("an internal answer at connect time rejects with the SSRF guard's error, nothing sent", async () => {
    Reflect.deleteProperty(penv, "SSRF_DEV_ALLOW_HOSTS");
    await expect(pinnedFetch(`${base}/hook`, { method: "POST", body: "x", timeoutMs: 5000 })).rejects.toMatchObject({
      code: "ESSRFBLOCKED",
    });
    expect(seen).toEqual([]);
  });
});

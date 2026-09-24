/**
 * @jest-environment node
 */
// A-16 — the catch-all proxy used to copy EVERY incoming header to the
// backend, X-Forwarded-For included, so the address the backend recorded for
// sessions, audit rows and e-signatures was only as good as the header that
// reached Next. It now drops every client-address header and sends one
// sanitized X-Forwarded-For: the rightmost entry, the one nginx wrote.

const cookieStore = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const forward = (headers: Record<string, string>) =>
  GET(new NextRequest("http://localhost/api/v1/calibration-devices?page=1", { headers }), {
    params: Promise.resolve({ path: ["calibration-devices"] }),
  });

/** The headers the proxy sent to the backend on its one fetch. */
const sentHeaders = (): Headers => {
  expect(global.fetch).toHaveBeenCalledTimes(1);
  return (global.fetch as jest.Mock).mock.calls[0][1].headers as Headers;
};

describe("/api/v1/[...path] proxy — the client address (A-16)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cookieStore.get.mockReturnValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () => new TextEncoder().encode('{"success":true,"data":[]}').buffer,
    }) as jest.Mock;
  });

  it("the proxy does not forward a browser-supplied X-Forwarded-For verbatim", async () => {
    const res = await forward({
      // As it reaches Next through a proxy that appends: the browser's forged
      // entry on the left, the hop's own on the right.
      "x-forwarded-for": "6.6.6.6, 203.0.113.9",
      accept: "application/json",
    });

    expect(res.status).toBe(200);
    const headers = sentHeaders();
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    // Ordinary headers are still copied.
    expect(headers.get("accept")).toBe("application/json");
  });

  it("drops every other client-address header the browser can send", async () => {
    await forward({
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "6.6.6.6",
      "cf-connecting-ip": "6.6.6.6",
      forwarded: "for=6.6.6.6",
      "true-client-ip": "6.6.6.6",
      "x-client-ip": "6.6.6.6",
      "x-cluster-client-ip": "6.6.6.6",
    });

    const headers = sentHeaders();
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    for (const name of [
      "x-real-ip",
      "cf-connecting-ip",
      "forwarded",
      "true-client-ip",
      "x-client-ip",
      "x-cluster-client-ip",
    ]) {
      expect(headers.get(name)).toBeNull();
    }
  });

  it("sends no X-Forwarded-For at all rather than an unparsable one", async () => {
    await forward({ "x-forwarded-for": "not-an-address" });

    expect(sentHeaders().get("x-forwarded-for")).toBeNull();
  });
});

/**
 * @jest-environment node
 */
// A-189 — the proxy's fetch sets `Host` to the backend's address, so the
// backend built certificate-verification and signed-download links on
// `http://backend:3000`. The proxy now sends the origin the request arrived
// on as X-Forwarded-Host / X-Forwarded-Proto — derived from the request Next
// received, never copied from what the browser sent.

const cookieStore = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";
import { forwardedOriginHeaders } from "@/lib/forwardedOrigin";

const forward = (url: string, headers: Record<string, string>) =>
  GET(new NextRequest(url, { headers }), {
    params: Promise.resolve({ path: ["certificates", "verify", "C-1"] }),
  });

const sentHeaders = (): Headers => {
  expect(global.fetch).toHaveBeenCalledTimes(1);
  return (global.fetch as jest.Mock).mock.calls[0][1].headers as Headers;
};

describe("/api/v1/[...path] proxy — the public origin (A-189)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cookieStore.get.mockReturnValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () => new TextEncoder().encode('{"success":true,"data":{}}').buffer,
    }) as jest.Mock;
  });

  it("sends the Host the request arrived with, and the scheme nginx recorded", async () => {
    await forward("http://callibrator.example/api/v1/certificates/verify/C-1", {
      host: "callibrator.example",
      "x-forwarded-proto": "https",
    });

    const headers = sentHeaders();
    expect(headers.get("x-forwarded-host")).toBe("callibrator.example");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    // The proxy never forwards Host itself; fetch sets the backend's.
    expect(headers.get("host")).toBeNull();
  });

  it("replaces a browser-sent X-Forwarded-Host / -Port instead of copying it", async () => {
    await forward("http://callibrator.example/api/v1/certificates/verify/C-1", {
      host: "callibrator.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-port": "8443",
    });

    const headers = sentHeaders();
    expect(headers.get("x-forwarded-host")).toBe("callibrator.example");
    expect(headers.get("x-forwarded-port")).toBeNull();
  });

  it("with no usable upstream scheme, uses the one Next was reached on", async () => {
    await forward("http://localhost:3000/api/v1/certificates/verify/C-1", {
      host: "localhost:3000",
      "x-forwarded-proto": "gopher",
    });

    expect(sentHeaders().get("x-forwarded-proto")).toBe("http");
  });
});

describe("forwardedOriginHeaders", () => {
  it("takes the nearest (rightmost) scheme of a list", () => {
    expect(
      forwardedOriginHeaders(new Headers({ host: "a.example", "x-forwarded-proto": "http, https" }), "http:")
    ).toEqual({ "X-Forwarded-Host": "a.example", "X-Forwarded-Proto": "https" });
  });

  it("sends no X-Forwarded-Host when the request has no Host", () => {
    expect(forwardedOriginHeaders(new Headers(), "https:")).toEqual({ "X-Forwarded-Proto": "https" });
  });
});

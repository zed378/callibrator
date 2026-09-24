/**
 * @jest-environment node
 */
// A-16 — the Next proxy routes forward ONE client address: the rightmost
// X-Forwarded-For entry, which behind nginx is the only one and is the address
// nginx resolved. Never the header as the browser sent it.

import { CLIENT_ADDRESS_HEADERS, clientIpHeader, forwardedClientIp } from "./clientIp";

const h = (init: Record<string, string>) => new Headers(init);

describe("forwardedClientIp (A-16)", () => {
  it("returns the single address nginx wrote", () => {
    expect(forwardedClientIp(h({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("a browser-prepended entry cannot choose the address: the nearest (rightmost) hop wins", () => {
    expect(
      forwardedClientIp(h({ "x-forwarded-for": "6.6.6.6, 10.0.0.1,203.0.113.9 " })),
    ).toBe("203.0.113.9");
  });

  it("accepts IPv6", () => {
    expect(forwardedClientIp(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it.each([
    ["absent", {}],
    ["empty", { "x-forwarded-for": "" }],
    ["not an address", { "x-forwarded-for": "1.2.3.4, evil<script>" }],
    ["a trailing comma", { "x-forwarded-for": "1.2.3.4," }],
  ])("returns null when the header is %s", (_label, init) => {
    expect(forwardedClientIp(h(init as Record<string, string>))).toBeNull();
  });

  it("ignores every other address header — only nginx's X-Forwarded-For is read", () => {
    expect(
      forwardedClientIp(
        h({ "x-real-ip": "6.6.6.6", "cf-connecting-ip": "6.6.6.6", forwarded: "for=6.6.6.6" }),
      ),
    ).toBeNull();
  });
});

describe("clientIpHeader (A-16)", () => {
  it("is one X-Forwarded-For entry", () => {
    expect(clientIpHeader(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toEqual({
      "X-Forwarded-For": "203.0.113.9",
    });
  });

  it("is nothing at all, never an empty value, when there is no parsable address", () => {
    expect(clientIpHeader(h({ "x-forwarded-for": "garbage" }))).toEqual({});
  });

  it("names every client-address header the catch-all proxy must drop, lower-case", () => {
    expect(CLIENT_ADDRESS_HEADERS).toEqual(
      expect.arrayContaining(["x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip"]),
    );
    for (const name of CLIENT_ADDRESS_HEADERS) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

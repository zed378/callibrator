/**
 * The rsync image import's host keys (hostKeys.ts) and its SSRF / DPIA-gate guard (hostGuard.ts).
 *
 * hostGuard: the source host is resolved and EVERY address checked; loopback, RFC 1918,
 * link-local (the cloud metadata address), CGNAT and local names are refused unless the host
 * is on RSYNC_ALLOWED_HOSTS; while UPSTREAM_REAL_DATA_ALLOWED is off only a synthetic source on
 * an allow-listed host passes. The DNS lookup is a spy — no packet leaves the test.
 */
import { createHash } from "crypto";
import dns from "dns";
import { ACCEPTED_KEY_TYPES, FINGERPRINT_PATTERN, fingerprintOf, parseKeyscan } from "../../../services/upstreamFileImport/hostKeys";
import { assertSourceAllowed, resolveSource } from "../../../services/upstreamFileImport/hostGuard";
import { environment } from "../../../config/env";
import { AppError } from "../../../utils/appError.util";

const penv = environment();

const ED = Buffer.from("synthetic-ed25519-key-blob").toString("base64");
const RSA = Buffer.from("synthetic-rsa-key-blob").toString("base64");

describe("hostKeys", () => {
  it("fingerprints a key blob as OpenSSH does: SHA256 + unpadded base64", () => {
    const expected = createHash("sha256").update(Buffer.from(ED, "base64")).digest("base64").replace(/=+$/, "");
    expect(fingerprintOf(ED)).toBe(`SHA256:${expected}`);
    expect(fingerprintOf(ED)).toMatch(FINGERPRINT_PATTERN);
  });

  it("parses keyscan output: accepted types once each, strongest first; comments and junk ignored", () => {
    const out = [
      "# 203.0.113.7:22 SSH-2.0-OpenSSH_9.6",
      `203.0.113.7 ssh-rsa ${RSA}`,
      `203.0.113.7 ssh-ed25519 ${ED}`,
      `203.0.113.7 ssh-ed25519 ${RSA}`, // a second key of a type already seen: ignored
      "203.0.113.7 ssh-dss AAAAB3NzaC1kc3M=", // not an accepted type
      "203.0.113.7 ecdsa-sha2-nistp256 not*base64",
      "203.0.113.7 only-two",
      "",
    ].join("\r\n");
    const keys = parseKeyscan(out);
    expect(keys.map((k) => k.type)).toEqual(["ssh-ed25519", "ssh-rsa"]);
    expect(keys[0]).toEqual({ type: "ssh-ed25519", key: ED, fingerprint: fingerprintOf(ED) });
  });

  it("answers no key for empty output", () => {
    expect(parseKeyscan("")).toEqual([]);
    expect(ACCEPTED_KEY_TYPES[0]).toBe("ssh-ed25519");
  });
});

describe("hostGuard", () => {
  let lookup: jest.SpyInstance;

  beforeEach(() => {
    delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
    delete penv["RSYNC_ALLOWED_HOSTS"];
    lookup = jest.spyOn(dns.promises, "lookup");
  });

  afterAll(() => {
    delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
    delete penv["RSYNC_ALLOWED_HOSTS"];
  });

  const answers = (...addresses: string[]): void => {
    lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  };

  describe("assertSourceAllowed — the DPIA gate", () => {
    it("gate off: a real source is refused 403 before anything is resolved", () => {
      expect(() => { assertSourceAllowed("upstream.example.org", false); }).toThrow(AppError);
      try {
        assertSourceAllowed("upstream.example.org", false);
      } catch (err) {
        expect((err as AppError).status).toBe(403);
        expect((err as AppError).message).toMatch(/DPIA/);
      }
      expect(lookup).not.toHaveBeenCalled();
    });

    it("gate off: a synthetic source must be on an allow-listed host", () => {
      expect(() => { assertSourceAllowed("test-ssh", true); }).toThrow(/RSYNC_ALLOWED_HOSTS/);
      penv["RSYNC_ALLOWED_HOSTS"] = " Test-SSH , other ";
      expect(() => { assertSourceAllowed("TEST-ssh", true); }).not.toThrow();
    });

    it("gate on: any source passes the gate (the address check still applies)", () => {
      penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
      expect(() => { assertSourceAllowed("upstream.example.org", false); }).not.toThrow();
    });
  });

  describe("resolveSource — the SSRF guard", () => {
    it("a public name resolves to the address ssh will dial", async () => {
      answers("93.184.216.34", "8.8.4.4");
      await expect(resolveSource("upstream.example.org")).resolves.toEqual({ address: "93.184.216.34", allowListed: false });
    });

    it.each([
      ["loopback", "127.0.0.1"],
      ["RFC 1918", "10.1.200.13"],
      ["RFC 1918 (192.168)", "192.168.1.5"],
      ["link-local / cloud metadata", "169.254.169.254"],
      ["CGNAT", "100.64.0.1"],
      ["IPv6 loopback", "::1"],
      ["IPv6 unique-local", "fd00::1"],
    ])("refuses a host resolving to %s (%s)", async (_label, address) => {
      answers(address);
      await expect(resolveSource("rebind.example.org")).rejects.toMatchObject({ status: 400 });
    });

    it("refuses a host where ANY address is internal (a mixed answer)", async () => {
      answers("8.8.4.4", "10.0.0.5");
      await expect(resolveSource("mixed.example.org")).rejects.toMatchObject({ status: 400 });
    });

    it("refuses an internal literal address without a lookup", async () => {
      await expect(resolveSource("10.0.0.5")).rejects.toMatchObject({ status: 400 });
      expect(lookup).not.toHaveBeenCalled();
    });

    it("accepts a public literal address (documentation ranges such as 203.0.113.0/24 are refused like private ones) without a lookup", async () => {
      await expect(resolveSource("8.8.4.4")).resolves.toEqual({ address: "8.8.4.4", allowListed: false });
      expect(lookup).not.toHaveBeenCalled();
    });

    it.each([["localhost"], ["box.localhost"], ["printer.local"]])("refuses the local name %s", async (host) => {
      await expect(resolveSource(host)).rejects.toThrow(/local name/);
    });

    it("an allow-listed host may be internal (a test SSH server on the deployment's network)", async () => {
      penv["RSYNC_ALLOWED_HOSTS"] = "test-ssh,localhost";
      answers("172.18.0.4");
      await expect(resolveSource("test-ssh")).resolves.toEqual({ address: "172.18.0.4", allowListed: true });
      answers("127.0.0.1");
      await expect(resolveSource("localhost")).resolves.toEqual({ address: "127.0.0.1", allowListed: true });
    });

    it("an unresolvable host is a 400", async () => {
      lookup.mockRejectedValue(new Error("ENOTFOUND"));
      await expect(resolveSource("nope.example.org")).rejects.toThrow("could not be resolved");
      answers();
      await expect(resolveSource("empty.example.org")).rejects.toThrow("could not be resolved");
    });
  });
});

/**
 * Tests for SSRF protection util
 */
const dns = require("dns");
const {
  assertSafeUrl,
  assertResolvedHostIsPublic,
  isBlockedIp,
} = require("../../utils/ssrf.util");

describe("ssrf.util", () => {
  describe("isBlockedIp", () => {
    it.each([
      "10.0.0.5",
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "192.168.1.1",
      "172.16.5.5",
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "::1", // IPv6 loopback
      "fd00::1", // IPv6 ULA
      "fe80::1", // IPv6 link-local
      "::ffff:10.0.0.1", // IPv4-mapped private
      "not-an-ip",
      "::", // IPv6 unspecified
      "[::1]", // bracketed loopback
      "fe80::1%eth0", // zone id is stripped before matching
      "fc00::1", // ULA fc-prefix
      "ff02::1", // IPv6 multicast
      "::10.0.0.1", // IPv4-compatible private
      "224.0.0.1", // IPv4 multicast
      "240.0.0.1", // IPv4 reserved
      "",
    ])("blocks internal/invalid address %s", (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    });

    it.each(["8.8.8.8", "1.1.1.1", "203.0.114.1", "2606:4700:4700::1111"])(
      "allows public address %s",
      (ip) => {
        expect(isBlockedIp(ip)).toBe(false);
      },
    );
  });

  describe("assertSafeUrl", () => {
    it("accepts a public https URL", () => {
      expect(() => assertSafeUrl("https://example.com/hook")).not.toThrow();
    });

    it.each([
      ["not a url", "notaurl"],
      ["non-http scheme", "ftp://example.com"],
      ["embedded credentials", "https://user:pass@example.com"],
      ["localhost", "http://localhost:3000/x"],
      [".local host", "http://printer.local/x"],
      ["loopback ip", "http://127.0.0.1/x"],
      ["private ip", "http://10.1.2.3/x"],
      ["metadata ip", "http://169.254.169.254/latest/meta-data"],
    ])("rejects %s", (_label, url) => {
      expect(() => assertSafeUrl(url)).toThrow();
    });
  });

  describe("assertResolvedHostIsPublic", () => {
    afterEach(() => jest.restoreAllMocks());

    it("resolves when the host maps to a public IP", async () => {
      jest
        .spyOn(dns.promises, "lookup")
        .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      await expect(
        assertResolvedHostIsPublic("https://example.com/hook"),
      ).resolves.toBeUndefined();
    });

    it("rejects when the host resolves to an internal IP (DNS-based SSRF)", async () => {
      jest
        .spyOn(dns.promises, "lookup")
        .mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
      await expect(
        assertResolvedHostIsPublic("https://sneaky.example.com/hook"),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects when the host cannot be resolved", async () => {
      jest
        .spyOn(dns.promises, "lookup")
        .mockRejectedValue(new Error("ENOTFOUND"));
      await expect(
        assertResolvedHostIsPublic("https://does-not-exist.example/hook"),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects when DNS resolves the host to zero addresses", async () => {
      jest.spyOn(dns.promises, "lookup").mockResolvedValue([]);
      await expect(
        assertResolvedHostIsPublic("https://empty.example.com/hook"),
      ).rejects.toMatchObject({
        status: 400,
        message: "URL host could not be resolved",
      });
    });

    it("rejects when only one of several resolved addresses is internal", async () => {
      jest.spyOn(dns.promises, "lookup").mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
      await expect(
        assertResolvedHostIsPublic("https://rebind.example.com/hook"),
      ).rejects.toMatchObject({
        status: 400,
        message: "URL host resolves to a disallowed (internal) address",
      });
    });

    it("strips brackets from an IPv6 literal host and skips DNS", async () => {
      const spy = jest.spyOn(dns.promises, "lookup");
      await expect(
        assertResolvedHostIsPublic("https://[2606:4700:4700::1111]/hook"),
      ).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it("does not perform DNS for a literal public IP host", async () => {
      const spy = jest.spyOn(dns.promises, "lookup");
      await expect(
        assertResolvedHostIsPublic("https://8.8.8.8/hook"),
      ).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

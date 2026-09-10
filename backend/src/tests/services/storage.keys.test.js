const keys = require("../../services/storage/keys");

describe("storage keys — construction", () => {
  it("namespaces a tenant object under t/<tenantId>/<domain>/", () => {
    expect(
      keys.buildKey({ tenantId: "tenant-1", domain: "attachments", name: "a.pdf" }),
    ).toBe("t/tenant-1/attachments/a.pdf");
  });

  it("namespaces a platform object under global/", () => {
    expect(keys.buildKey({ domain: "branding", name: "logo.png" })).toBe(
      "global/branding/logo.png",
    );
  });

  it("rejects a domain outside the allowlist", () => {
    expect(() =>
      keys.buildKey({ tenantId: "t1", domain: "../../etc", name: "x" }),
    ).toThrow("Unknown storage domain");
  });

  it("rejects a traversal attempt in the name", () => {
    expect(() =>
      keys.buildKey({ tenantId: "t1", domain: "attachments", name: "../evil" }),
    ).toThrow("Invalid storage key");
  });
});

describe("storage keys — normalization", () => {
  it.each([
    ["empty", ""],
    ["not a string", 123],
    ["parent traversal", "t/a/attachments/../../../etc/passwd"],
    ["bare parent segment", ".."],
    ["current-dir segment", "t/a/./x"],
    ["leading slash", "/t/a/attachments/x"],
    ["trailing slash", "t/a/attachments/"],
    ["double slash", "t/a//x"],
    // Backslash is a path separator on Windows, so a key containing one would
    // traverse on the local driver while looking inert to a naive check.
    ["backslash", "t/a\\..\\..\\etc"],
    ["null byte", "t/a/attachments/x\0.png"],
    ["space", "t/a/attachments/my file.png"],
    ["segment starting with a dot", "t/a/attachments/.hidden"],
  ])("rejects a key with %s", (_label, key) => {
    expect(() => keys.normalizeKey(key)).toThrow();
  });

  it("rejects an absurdly long key", () => {
    expect(() => keys.normalizeKey("a".repeat(1025))).toThrow(
      "Storage key too long",
    );
  });

  it("accepts a well-formed key unchanged", () => {
    const key = "t/tenant-1/certificates/abc-123_v2.pdf";
    expect(keys.normalizeKey(key)).toBe(key);
  });
});

describe("storage keys — tenant guard", () => {
  it("accepts a key inside the tenant's namespace", () => {
    expect(
      keys.assertKeyForTenant("t/tenant-1/attachments/a.pdf", "tenant-1"),
    ).toBe("t/tenant-1/attachments/a.pdf");
  });

  it("refuses another tenant's key", () => {
    expect(() =>
      keys.assertKeyForTenant("t/tenant-2/attachments/a.pdf", "tenant-1"),
    ).toThrow("does not belong to this tenant");
  });

  it("refuses a tenant-id prefix that merely starts the same", () => {
    // "t/tenant-10/..." must not satisfy a guard for tenant "tenant-1".
    expect(() =>
      keys.assertKeyForTenant("t/tenant-10/attachments/a.pdf", "tenant-1"),
    ).toThrow("does not belong to this tenant");
  });

  it("refuses a global key for a tenant", () => {
    expect(() =>
      keys.assertKeyForTenant("global/branding/logo.png", "tenant-1"),
    ).toThrow("does not belong to this tenant");
  });

  it("denies by default: no tenant reaches only global/, never a tenant key", () => {
    expect(keys.assertKeyForTenant("global/branding/logo.png", null)).toBe(
      "global/branding/logo.png",
    );
    expect(() =>
      keys.assertKeyForTenant("t/tenant-1/attachments/a.pdf", null),
    ).toThrow("does not belong to this tenant");
  });
});

describe("storage keys — scope prefixes", () => {
  it("scopes a whole tenant", () => {
    expect(keys.scopePrefix("tenant-1")).toBe("t/tenant-1/");
  });

  it("scopes one domain of a tenant", () => {
    expect(keys.scopePrefix("tenant-1", "certificates")).toBe(
      "t/tenant-1/certificates/",
    );
  });

  it("scopes the global namespace", () => {
    expect(keys.scopePrefix(null)).toBe("global/");
    expect(keys.scopePrefix(null, "branding")).toBe("global/branding/");
  });

  it("rejects an unknown domain", () => {
    expect(() => keys.scopePrefix("tenant-1", "nope")).toThrow(
      "Unknown storage domain",
    );
  });

  it("exposes the raw prefixes", () => {
    expect(keys.tenantPrefix("t1")).toBe("t/t1/");
    expect(keys.globalPrefix()).toBe("global/");
    expect(keys.DOMAINS).toContain("attachments");
  });
});

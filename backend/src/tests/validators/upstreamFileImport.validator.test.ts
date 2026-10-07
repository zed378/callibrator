/**
 * The rsync image import's request schemas (validators/upstreamFileImport.validator.ts): the
 * values that reach an argument vector are held to a narrow alphabet, so an injection attempt
 * is a 400 before any vector is built (the vector builder's `--` is the second, independent
 * layer — tests/services/upstreamFileImport/sshArgs.test.ts).
 */
import {
  checkConnectionSchema,
  importIdSchema,
  listImportsSchema,
  remotePath,
  sourceHost,
  startImportSchema,
} from "../../validators/upstreamFileImport.validator";

const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----\n";
const FP = `SHA256:${"A".repeat(43)}`;

const base = {
  host: "upstream.example.org",
  username: "importer",
  authMethod: "password",
  password: "pw",
  remotePath: "/var/www/app/public/uploads/",
  fileClasses: ["front", "serial"],
};

describe("sourceHost", () => {
  it.each([["upstream.example.org"], ["UPSTREAM.Example.ORG"], ["test-ssh"], ["10.0.0.5"], ["2001:db8::7"], ["a.b.c."]])("accepts %s", (h) => {
    expect(sourceHost.safeParse(h).success).toBe(true);
  });

  it("lower-cases", () => {
    expect(sourceHost.parse("Upstream.Example.ORG")).toBe("upstream.example.org");
  });

  it.each([
    ["an option", "-oProxyCommand=sh"],
    ["a shell payload", "host;reboot"],
    ["a command substitution", "$(id)"],
    ["a space", "up stream"],
    ["a user part", "root@host"],
    ["a port suffix", "host:22"],
    ["a leading hyphen label", "a.-b.c"],
    ["a trailing hyphen label", "a-.b"],
    ["empty", ""],
    ["a backtick", "`id`"],
  ])("refuses %s", (_label, h) => {
    expect(sourceHost.safeParse(h).success).toBe(false);
  });
});

describe("remotePath", () => {
  it("accepts an absolute path and drops one trailing slash", () => {
    expect(remotePath.parse("/var/www/app/public/uploads/")).toBe("/var/www/app/public/uploads");
    expect(remotePath.parse("/srv/a_b-c.d@e+f")).toBe("/srv/a_b-c.d@e+f");
  });

  it.each([
    ["relative", "var/www"],
    ["the root alone", "/"],
    ["a .. segment", "/var/../etc"],
    ["a . segment", "/var/./www"],
    ["a double slash", "/var//www"],
    ["a space", "/var/my uploads"],
    ["a shell metacharacter", "/var/www;rm -rf /"],
    ["a command substitution", "/var/$(id)"],
    ["a quote", "/var/'x'"],
    ["a backslash", "/var/x\\y"],
    ["a newline", "/var/x\ny"],
    ["an option-shaped segment is fine as a path but a glob is not", "/var/*"],
  ])("refuses %s", (_label, p) => {
    expect(remotePath.safeParse(p).success).toBe(false);
  });
});

describe("checkConnectionSchema", () => {
  it("defaults the port to 22 and the source to real (not synthetic)", () => {
    expect(checkConnectionSchema.parse(base)).toMatchObject({ port: 22, syntheticSource: false, remotePath: "/var/www/app/public/uploads" });
  });

  it("key auth with a key, no password", () => {
    const parsed = checkConnectionSchema.parse({ ...base, authMethod: "key", password: undefined, privateKey: KEY, confirmedFingerprint: FP, port: 2222 });
    expect(parsed).toMatchObject({ authMethod: "key", port: 2222, confirmedFingerprint: FP });
  });

  it.each([
    ["a password method without a password", { password: undefined }],
    ["a password method with a key as well", { privateKey: KEY }],
    ["a key method without a key", { authMethod: "key", password: undefined }],
    ["a key method with a password as well", { authMethod: "key", privateKey: KEY }],
    ["a password with a line break", { password: "a\nb" }],
    ["an empty password", { password: "" }],
    ["an encrypted key", { authMethod: "key", password: undefined, privateKey: KEY.replace("b3Bl", "Proc-Type: 4,ENCRYPTED\nb3Bl") }],
    ["a key that is not a key block", { authMethod: "key", password: undefined, privateKey: "ssh-ed25519 AAAA public" }],
    ["an option-shaped user", { username: "-oProxyCommand=x" }],
    ["a user with @", { username: "a@b" }],
    ["a port out of range", { port: 70_000 }],
    ["no file class", { fileClasses: [] }],
    ["the certificate folder", { fileClasses: ["inventory"] }],
    ["a class twice", { fileClasses: ["front", "front"] }],
    ["a malformed fingerprint", { confirmedFingerprint: "MD5:aa:bb" }],
    ["an unknown method", { authMethod: "agent" }],
  ])("refuses %s", (_label, over) => {
    expect(checkConnectionSchema.safeParse({ ...base, ...over }).success).toBe(false);
  });
});

describe("startImportSchema", () => {
  const start = { ...base, confirmedFingerprint: FP, targetTenantId: "2b7c9e41-5d3a-4f6e-8a1b-0c9d8e7f6a5b" };

  it("requires a fingerprint and a target tenant; the bandwidth limit is optional", () => {
    expect(startImportSchema.parse(start)).toMatchObject({ targetTenantId: start.targetTenantId });
    expect(startImportSchema.parse({ ...start, bandwidthLimitKbps: 2048 }).bandwidthLimitKbps).toBe(2048);
    expect(startImportSchema.safeParse({ ...start, confirmedFingerprint: undefined }).success).toBe(false);
    expect(startImportSchema.safeParse({ ...start, targetTenantId: "nope" }).success).toBe(false);
    expect(startImportSchema.safeParse({ ...start, bandwidthLimitKbps: 10 }).success).toBe(false);
    expect(startImportSchema.safeParse({ ...start, password: undefined }).success).toBe(false);
  });
});

describe("list and id schemas", () => {
  it("coerces paging; refuses a bad id", () => {
    expect(listImportsSchema.parse({ page: "2", limit: "5" })).toEqual({ page: 2, limit: 5 });
    expect(listImportsSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(listImportsSchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(importIdSchema.safeParse({ id: "x" }).success).toBe(false);
  });
});

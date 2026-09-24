/**
 * A-228 — the log redaction format had no rule for email addresses or for
 * `*Link` keys.
 *
 *  - An email address is personal data. It reached the logs as a value
 *    (`to`, `email`, `recipient`) and inside messages (a Sequelize unique
 *    violation quotes the duplicate address).
 *  - A generated link (`activationLink`, `resetLink`, ...) carries its
 *    capability token in the URL; logging it logs a working credential.
 *
 * The real format, on hand-built records (as activityLog.test.js does). The
 * expectations are written out literally, not derived from the redactor's own
 * patterns, so deleting a rule fails a case here.
 */
process.env.NODE_ENV = "production";

const { redactFormat, isSensitiveKey, sanitizeUrl, logger } = require("../../middlewares/activityLog.middleware");

const redact = (info) => redactFormat().transform(info);

afterAll(() => {
  logger.exceptions.unhandle();
  logger.rejections.unhandle();
  logger.close();
});

describe("A-228 — email addresses are masked wherever they appear", () => {
  it("masks an address held under any key, keeping its first character and domain", () => {
    const out = redact({
      level: "info",
      message: "sent",
      to: "alice.smith@hospital-a.example",
      email: "Bob+tag@Sub.Hospital-B.co.id",
      recipients: ["c@x.org", "dave@clinic.example"],
      nested: { contact: { address: "eve_1@lab.example.com" } },
    });
    expect(out.to).toBe("a***@hospital-a.example");
    expect(out.email).toBe("B***@Sub.Hospital-B.co.id");
    expect(out.recipients).toEqual(["c***@x.org", "d***@clinic.example"]);
    expect(out.nested.contact.address).toBe("e***@lab.example.com");
  });

  it("masks every address inside a message or an error, and leaves the rest of the text", () => {
    const err = new Error('Key (email)=(frank@hospital.example) already exists');
    const out = redact({
      level: "error",
      message: "Could not notify grace@hospital.example or heidi@hospital.example: timeout",
      err,
    });
    expect(out.message).toBe("Could not notify g***@hospital.example or h***@hospital.example: timeout");
    expect(out.err.message).toBe("Key (email)=(f***@hospital.example) already exists");
    expect(out.err.stack).not.toContain("frank@");
  });

  it("does not touch strings that only look like an address fragment", () => {
    const out = redact({
      level: "info",
      message: "m",
      a: "user@localhost",
      b: "no at sign here",
      c: "price @ 5.00",
      d: "npm @scope/package",
    });
    expect(out.a).toBe("user@localhost");
    expect(out.b).toBe("no at sign here");
    expect(out.c).toBe("price @ 5.00");
    expect(out.d).toBe("npm @scope/package");
  });

  it("masks an address in a logged URL's query and path", () => {
    expect(sanitizeUrl("/api/v1/users?email=ivan@hospital.example&page=2")).toBe(
      "/api/v1/users?email=i***@hospital.example&page=2",
    );
    expect(sanitizeUrl("/api/v1/invite/judy@hospital.example")).toBe("/api/v1/invite/j***@hospital.example");
  });

  it("the real logger masks an address before any transport sees it", () => {
    const { Writable } = require("stream");
    const { transports } = require("winston");
    const records = [];
    const t = new transports.Stream({
      stream: new Writable({
        write(chunk, _enc, cb) {
          records.push(JSON.parse(chunk.toString()));
          cb();
        },
      }),
    });
    logger.add(t);
    logger.info("Password reset requested for mallory@hospital.example", { email: "mallory@hospital.example" });
    logger.remove(t);
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records[0])).not.toContain("mallory@");
    expect(records[0].email).toBe("m***@hospital.example");
  });
});

describe("A-228 — a key ending in `Link` is a credential", () => {
  it.each([
    "activationLink",
    "resetLink",
    "reset_link",
    "verificationLink",
    "inviteLink",
    "magic-link",
    "link",
  ])("%s is redacted", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
    const out = redact({ level: "info", message: "m", data: { [key]: "https://app.example/activate?t=abc" } });
    expect(out.data[key]).toBe("[REDACTED]");
  });

  it.each(["linkedDeviceId", "linkage", "hyperlinks", "email", "url"])("%s is not", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

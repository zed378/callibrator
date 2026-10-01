/**
 * P9-18 (keyRotation, its own change before the conversion): the re-wrap's
 * raw SQL goes through the bind-only helper, `sql()` (utils/sql.util, P9-07).
 *
 * The rotation used `sequelize.query` with named `replacements` (`:cursor`,
 * `:limit`, `:next`, `:id`, `:tenantId`, `:previous`), which a TypeScript
 * module may not do (P9-07's lint rule), and read the UPDATE's `rowCount` off
 * the driver's metadata. Now every statement is sent with `bind` values for
 * `$1…$n`, never `replacements`, and the UPDATE says how many rows it wrote by
 * `RETURNING id` (one row back = one row written).
 *
 * These assertions are about the CALLS; keyRotation.service.s08.test.js keeps
 * proving what the rotation does to the rows, and keyRotation.s08.live proves
 * it on PostgreSQL 18.
 */
import crypto from "crypto";

interface QueryOptions {
  type?: string;
  bind?: unknown[];
  replacements?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the service under test, as its callers load it
const { rewrapTarget, TARGETS } = require("../../services/keyRotation.service") as {
  rewrapTarget: (o: { sequelize: { query: jest.Mock }; target: unknown; batchSize?: number }) => Promise<{ rewrapped: number; failed: unknown[] }>;
  TARGETS: readonly unknown[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real envelope code
const kms = require("../../services/kms.service") as { encryptData: (t: string, p: string) => string };

const T1 = "11111111-1111-4111-8111-111111111111";
/** A v1 envelope (no key id) of `plain`: what a rotation must re-wrap. */
const asV1 = (envelope: string): string => ["v1", ...envelope.split(":").slice(2)].join(":");

describe("keyRotation — every statement is bound, none uses replacements", () => {
  it("SELECT page, UPDATE and re-read are sent through sql(): bind values, type SELECT, UPDATE ... RETURNING", async () => {
    const plain = crypto.randomBytes(8).toString("hex");
    const stored = asV1(kms.encryptData(T1, plain));
    let current = stored;
    const calls: [string, QueryOptions][] = [];
    const query = jest.fn((text: string, options: QueryOptions = {}) => {
      calls.push([text.replace(/\s+/g, " ").trim(), options]);
      const s = text.replace(/\s+/g, " ").trim();
      if (s.startsWith("SELECT id::text AS id")) {
        // Page 1 has the one row; any later page (a cursor, however it is passed) is empty.
        const legacyCursor = (options.replacements as { cursor?: unknown } | undefined)?.cursor;
        const cursor = options.bind?.[1] ?? legacyCursor ?? null;
        return Promise.resolve(cursor === null ? [{ id: "s1", tenant_id: T1, value: current }] : []);
      }
      if (s.startsWith("UPDATE")) {
        const legacyNext = (options.replacements as { next?: string } | undefined)?.next;
        current = (options.bind?.[0] as string | undefined) ?? legacyNext ?? current;
        // The helper's shape (rows back) and the driver's (a result/metadata pair) both say one row.
        return Promise.resolve(options.bind ? [{ id: "s1" }] : [[], { rowCount: 1 }]);
      }
      return Promise.resolve([{ value: current }]);
    });

    const report = await rewrapTarget({ sequelize: { query }, target: TARGETS[0], batchSize: 5 });

    expect(report.failed).toEqual([]);
    expect(report.rewrapped).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const [text, options] of calls) {
      expect(options).not.toHaveProperty("replacements");
      expect(options.type).toBe("SELECT");
      expect(Array.isArray(options.bind)).toBe(true);
      expect(text).not.toMatch(/(?<!:):[a-zA-Z]/);
    }
    const update = calls.find(([text]) => text.startsWith("UPDATE"));
    expect(update?.[0]).toMatch(/RETURNING id$/);
    expect(update?.[1].bind).toEqual([current, "s1", T1, stored]);
  });
});

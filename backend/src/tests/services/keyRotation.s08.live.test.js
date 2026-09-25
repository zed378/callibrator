/**
 * S-08 / P6-10 — the key-rotation REHEARSAL, against a real PostgreSQL.
 *
 * Seeds the three places secrets live, in the forms a database written before
 * P6-10 holds them — v1 KMS envelopes in tenant_settings and webhooks, legacy
 * AES-CBC signing keys in tenant_keys — then runs, as separate "processes"
 * each booted with its own environment:
 *
 *   1. migration 0058 (legacy signing keys -> KMS envelopes), old KMS key A;
 *   2. the rotation A -> B: dry run, then the re-wrap (keys:rotate), with A
 *      still configured as previous;
 *   3. a process with ONLY key B reads every secret back — A is gone;
 *   4. a second re-wrap run finds nothing to do (resumable, idempotent);
 *   5. an INTERRUPTED rotation leaves every row readable by a ring holding
 *      both keys (the rollback is: keep the previous key);
 *   6. 0058 down restores the legacy form the pre-0058 code reads.
 *
 * OPT-IN, needs an empty scratch database (see dataIntegrity.p6.live.test.js):
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=54335 DB_NAME=callibrator_keys_p6 \
 *     DB_USER=cal_owner DB_PASS=owner npm test -- src/tests/services/keyRotation.s08.live --coverage=false
 *
 * Rehearsed on PostgreSQL 16 against SEEDED data, not a copy of production:
 * that rehearsal is still owed before the first real rotation (the runbook
 * says so).
 */
const crypto = require("crypto");
const { encryptPrivateKeyForTest } = require("../utils/esignatureKey.utils");
const { keyIdOf } = require("../../utils/keyring.util");

const live = process.env.DATA_PG_LIVE_TEST === "1" ? describe : describe.skip;

const KEY_A = "a7".repeat(32);
const KEY_B = "b8".repeat(32);
const ENCRYPT = "legacy-encrypt-key";
const TENANTS = ["a8a8a8a8-0000-4000-8000-00000000000a", "b8b8b8b8-0000-4000-8000-00000000000b"];
const idOf = (hex) => keyIdOf(Buffer.from(hex, "hex"));

/** A process booted with `env`: its own modules, its own pool. */
const boot = (env) => {
  const saved = { ...process.env };
  delete process.env.KMS_MASTER_KEY_PREVIOUS;
  delete process.env.ENCRYPT_KEY_PREVIOUS;
  delete process.env.ENCRYPT_KEY;
  Object.assign(process.env, env);
  let graph;
  try {
    jest.isolateModules(() => {
      const { db } = require("../../config");
      db.options.logging = false;
      graph = {
        db,
        kms: require("../../services/kms.service"),
        wrap: require("../../services/signingKeyWrap.service"),
        rotation: require("../../services/keyRotation.service"),
        m0058: require("../../migrations/0058-tenant-keys-kms-envelope"),
        models: require("../../models"),
      };
    });
  } finally {
    process.env = saved;
  }
  return graph;
};

live("S-08 — KMS key rotation rehearsal (live PostgreSQL)", () => {
  const pems = {};
  const secrets = {};
  let owner;

  const read = async (p, sql) => p.db.query(sql, { type: "SELECT" });

  /** Read every secret back through process `p`, as the application would. */
  const readAll = async (p) => {
    const out = {};
    for (const r of await read(p, "SELECT tenant_id, key, value FROM tenant_settings ORDER BY key")) {
      out[`setting:${r.key}`] = p.kms.decryptData(r.tenant_id, r.value);
    }
    for (const r of await read(p, "SELECT tenant_id, url, secret FROM webhooks ORDER BY url")) {
      out[`webhook:${r.url}`] = p.kms.decryptData(r.tenant_id, r.secret);
    }
    for (const r of await read(p, "SELECT tenant_id, key_id, private_key FROM tenant_keys ORDER BY key_id")) {
      out[`key:${r.key_id}`] = p.wrap.unwrapPrivateKey(r.tenant_id, r.private_key);
    }
    return out;
  };

  beforeAll(async () => {
    if (!/scratch|_p6$/.test(process.env.DB_NAME || "")) {
      throw new Error("Refusing: use a scratch database (see the header)");
    }
    // The database as P6-10 finds it: written under key A, legacy signing keys.
    owner = boot({ KMS_MASTER_KEY: KEY_A, ENCRYPT_KEY: ENCRYPT });
    await owner.db.sync({ force: true });
    for (const [i, tenantId] of TENANTS.entries()) {
      await owner.db.query(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :name, :sub, :email, now(), now())`,
        { replacements: { id: tenantId, name: `Rot ${i}`, sub: `rot-${i}`, email: `rot${i}@live.test` } },
      );
      // A v1 envelope, as kms.service wrote them before key ids.
      const v1 = owner.kms.encryptData(tenantId, `stripe-${i}`).split(":");
      const legacyV1 = ["v1", ...v1.slice(2)].join(":");
      secrets[`setting:stripe_secret_key_${i}`] = `stripe-${i}`;
      await owner.db.query(
        `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :key, :value, now(), now())`,
        { replacements: { t: tenantId, key: `stripe_secret_key_${i}`, value: legacyV1 } },
      );
      await owner.db.query(
        `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :key, 'plain, not secret', now(), now())`,
        { replacements: { t: tenantId, key: `display_name_${i}` } },
      );
      secrets[`setting:display_name_${i}`] = "plain, not secret";
      secrets[`webhook:https://hook-${i}.example`] = `whsec-${i}`;
      await owner.db.query(
        `INSERT INTO webhooks (id, tenant_id, url, secret, events, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :url, :secret, '["*"]', true, now(), now())`,
        {
          replacements: {
            t: tenantId,
            url: `https://hook-${i}.example`,
            secret: owner.kms.encryptData(tenantId, `whsec-${i}`),
          },
        },
      );
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 1024,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      pems[i] = privateKey;
      secrets[`key:key-${i}`] = privateKey;
      await owner.db.query(
        `INSERT INTO tenant_keys (id, tenant_id, key_id, key_type, algorithm, public_key, private_key, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :kid, 'esignature', 'RS256', :pub, :priv, now(), now())`,
        {
          replacements: {
            t: tenantId,
            kid: `key-${i}`,
            pub: publicKey,
            priv: encryptPrivateKeyForTest(privateKey, ENCRYPT),
          },
        },
      );
    }
    expect(await readAll(owner)).toEqual(secrets);
  });

  afterAll(async () => {
    await owner.db.close();
  });

  it("1. migration 0058 moves every legacy signing key to a KMS envelope under its tenant", async () => {
    await owner.m0058.up({ context: owner.db.getQueryInterface() });
    const rows = await read(owner, "SELECT tenant_id, private_key FROM tenant_keys");
    expect(rows.every((r) => r.private_key.startsWith(`v2:${idOf(KEY_A)}:`))).toBe(true);
    expect(await readAll(owner)).toEqual(secrets);
    // Tenant-bound now: tenant 0's key under tenant 1's id does not open.
    const r0 = rows.find((r) => r.tenant_id === TENANTS[0]);
    expect(() => owner.wrap.unwrapPrivateKey(TENANTS[1], r0.private_key)).toThrow();
    // And a second run is a no-op.
    await owner.m0058.up({ context: owner.db.getQueryInterface() });
    expect(await readAll(owner)).toEqual(secrets);
  });

  it("2-4. rotation A -> B: dry run writes nothing; re-wrap; a process with ONLY B reads everything; rerun is a no-op", async () => {
    const rotating = boot({ KMS_MASTER_KEY: KEY_B, KMS_MASTER_KEY_PREVIOUS: KEY_A });
    try {
      const before = await read(rotating, "SELECT value FROM tenant_settings ORDER BY id");
      const dry = await rotating.rotation.rewrapAll({ sequelize: rotating.db, dryRun: true });
      expect(dry.failed).toBe(0);
      expect(dry.reports.map((r) => [r.table, r.rewrapped])).toEqual([
        ["tenant_settings", 2], // the two secrets; the plain setting is not an envelope
        ["webhooks", 2],
        ["tenant_keys", 2],
      ]);
      expect(await read(rotating, "SELECT value FROM tenant_settings ORDER BY id")).toEqual(before);

      const run = await rotating.rotation.rewrapAll({ sequelize: rotating.db, batchSize: 1 });
      expect(run.failed).toBe(0);
      expect(run.reports.reduce((n, r) => n + r.rewrapped, 0)).toBe(6);

      const again = await rotating.rotation.rewrapAll({ sequelize: rotating.db });
      expect(again.reports.reduce((n, r) => n + r.rewrapped + r.converted, 0)).toBe(0);
    } finally {
      await rotating.db.close();
    }

    const onlyB = boot({ KMS_MASTER_KEY: KEY_B }); // key A removed from the ring
    try {
      expect(await readAll(onlyB)).toEqual(secrets);
      const values = [
        ...(await read(onlyB, "SELECT value AS v FROM tenant_settings WHERE key LIKE 'stripe%'")),
        ...(await read(onlyB, "SELECT secret AS v FROM webhooks")),
        ...(await read(onlyB, "SELECT private_key AS v FROM tenant_keys")),
      ];
      expect(values.every((r) => r.v.startsWith(`v2:${idOf(KEY_B)}:`))).toBe(true);
    } finally {
      await onlyB.db.close();
    }
  });

  it("5. an INTERRUPTED rotation B -> A leaves a mixed table every ring-holding process reads (the rollback)", async () => {
    const back = boot({ KMS_MASTER_KEY: KEY_A, KMS_MASTER_KEY_PREVIOUS: KEY_B });
    try {
      // Only one table re-wrapped: the rotation "died" after webhooks.
      await back.rotation.rewrapAll({ sequelize: back.db, tables: ["webhooks"] });
      expect(await readAll(back)).toEqual(secrets);
      // A process with only the NEW key cannot read the untouched rows — why
      // the previous key must stay until the re-wrap reports zero.
      const tooEarly = boot({ KMS_MASTER_KEY: KEY_A });
      try {
        await expect(readAll(tooEarly)).rejects.toThrow("Failed to decrypt data");
      } finally {
        await tooEarly.db.close();
      }
      // Resuming finishes the job.
      const rest = await back.rotation.rewrapAll({ sequelize: back.db });
      expect(rest.reports.find((r) => r.table === "webhooks").rewrapped).toBe(0);
      expect(rest.failed).toBe(0);
    } finally {
      await back.db.close();
    }
  });

  it("6. 0058 down restores the legacy AES-CBC form, readable with ENCRYPT_KEY alone", async () => {
    const p = boot({ KMS_MASTER_KEY: KEY_A, ENCRYPT_KEY: ENCRYPT });
    try {
      await p.m0058.down({ context: p.db.getQueryInterface() });
      const rows = await read(p, "SELECT key_id, private_key FROM tenant_keys ORDER BY key_id");
      expect(rows.every((r) => /^[0-9a-f]{32}:[0-9a-f]+$/.test(r.private_key))).toBe(true);
      // Decrypt exactly as the PRE-0058 code did.
      const key = crypto.createHash("sha256").update(ENCRYPT).digest();
      const [ivHex, ct] = rows[0].private_key.split(":");
      const d = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
      expect(d.update(ct, "hex", "utf8") + d.final("utf8")).toBe(pems[0]);
      // And up again.
      await p.m0058.up({ context: p.db.getQueryInterface() });
      expect(await readAll(p)).toEqual(secrets);
    } finally {
      await p.db.close();
    }
  });

  it("0058 REFUSES, changing nothing, when a legacy key cannot be decrypted", async () => {
    const p = boot({ KMS_MASTER_KEY: KEY_A, ENCRYPT_KEY: "the-wrong-key" });
    try {
      await p.db.query("UPDATE tenant_keys SET private_key = :legacy WHERE key_id = 'key-1'", {
        replacements: { legacy: encryptPrivateKeyForTest(pems[1], ENCRYPT) },
      });
      const before = await read(p, "SELECT key_id, private_key FROM tenant_keys ORDER BY key_id");
      await expect(p.m0058.up({ context: p.db.getQueryInterface() })).rejects.toThrow(
        /0058: 1 tenant signing key\(s\) could not be moved/,
      );
      expect(await read(p, "SELECT key_id, private_key FROM tenant_keys ORDER BY key_id")).toEqual(before);
    } finally {
      await p.db.close();
    }
  });
});

/**
 * S-20 (ADR-080) — the User model refuses to store a TOTP seed in plaintext,
 * on every ORM write path (instance save, bulkCreate, static update, upsert).
 *
 * The REAL model on an unconnected PostgreSQL-dialect Sequelize; the hooks
 * are run directly. Against PostgreSQL 18: secretsAtRest.s20.live.test.js.
 */
const { Sequelize, DataTypes } = require("sequelize");
const mfaService = require("../../services/mfa.service");

const User = require("../../models/user.model")(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);

const ID = "5e5e5e5e-0000-4000-8000-000000000030";
const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const REFUSAL = /refusing to store mfa(Pending)?Secret in plaintext/;

const build = (values) =>
  User.build({ id: ID, username: "ada", email: "ada@x.test", password: "h", firstName: "A", lastName: "L", ...values });

describe("S-20 — User model: no plaintext TOTP seed reaches the database", () => {
  it("both seed columns are TEXT (an envelope is ~200 characters)", () => {
    expect(User.rawAttributes.mfaSecret.type.key).toBe("TEXT");
    expect(User.rawAttributes.mfaPendingSecret.type.key).toBe("TEXT");
  });

  it.each(["mfaSecret", "mfaPendingSecret"])("an instance save of a plaintext %s is refused", async (attribute) => {
    await expect(User.runHooks("beforeSave", build({ [attribute]: SEED }), {})).rejects.toThrow(REFUSAL);
  });

  it("an instance save of an envelope, of null, or of other columns passes", async () => {
    await expect(
      User.runHooks("beforeSave", build({ mfaSecret: mfaService.sealSecret(ID, SEED), mfaPendingSecret: null }), {}),
    ).resolves.toBeUndefined();
    await expect(User.runHooks("beforeSave", build({ firstName: "B" }), {})).resolves.toBeUndefined();
  });

  it("an UNCHANGED legacy value loaded from the database does not block an unrelated save", async () => {
    const row = User.build({ id: ID, mfaSecret: SEED }, { isNewRecord: false, raw: true });
    row.firstName = "Changed";
    await expect(User.runHooks("beforeSave", row, {})).resolves.toBeUndefined();
  });

  it("bulkCreate refuses a plaintext seed", async () => {
    await expect(User.runHooks("beforeBulkCreate", [build({}), build({ mfaPendingSecret: SEED })], {})).rejects.toThrow(
      REFUSAL,
    );
    await expect(User.runHooks("beforeBulkCreate", [build({})], {})).resolves.toBeUndefined();
  });

  it("a static update refuses a plaintext seed and passes an envelope or a clear", async () => {
    await expect(User.runHooks("beforeBulkUpdate", { attributes: { mfaSecret: SEED }, where: { id: ID } })).rejects.toThrow(
      REFUSAL,
    );
    await expect(
      User.runHooks("beforeBulkUpdate", { attributes: { ...mfaService.MFA_CLEARED }, where: { id: ID } }),
    ).resolves.toBeUndefined();
    await expect(
      User.runHooks("beforeBulkUpdate", { attributes: { mfaSecret: mfaService.sealSecret(ID, SEED) }, where: { id: ID } }),
    ).resolves.toBeUndefined();
    await expect(User.runHooks("beforeBulkUpdate", { attributes: undefined, where: {} })).resolves.toBeUndefined();
  });

  it("an upsert refuses a plaintext seed", async () => {
    await expect(User.runHooks("beforeUpsert", { id: ID, mfaPendingSecret: SEED }, {})).rejects.toThrow(REFUSAL);
    await expect(User.runHooks("beforeUpsert", { id: ID, username: "x" }, {})).resolves.toBeUndefined();
  });
});

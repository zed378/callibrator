/**
 * D-40 — the certificate-number generator steps past EVERY tenant's numbers.
 *
 * `certificates.certificate_number` is unique platform-wide: it is the key
 * the public verification page (GET /certificates/verify/:number) resolves
 * with no tenant, so it must name exactly one certificate (ADR-063,
 * D-15). The generator read the last number under its prefix through the
 * tenant-scoped model, so it could not see a number another tenant held under
 * the same prefix — every code-less tenant shared "T" — and the insert failed
 * on the unique constraint. Proven on PostgreSQL 16.13 in
 * dataIdentity.dbA.live.test.js.
 */
const { Sequelize, DataTypes, Op } = require("sequelize");

const Certificate = require("../../models/certificate.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

describe("D-40 — Certificate.generateCertificateNumber", () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  it("looks up the highest number under the prefix across every tenant, soft-deleted included", async () => {
    const findOne = jest.fn(async () => ({ certificateNumber: `CERT-${today}-TAAAA-0007` }));

    const number = await Certificate.generateCertificateNumber("TAAAA", {
      Certificate: { findOne },
      Sequelize: { Op },
    });

    expect(number).toBe(`CERT-${today}-TAAAA-0008`);
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { certificateNumber: { [Op.like]: `CERT-${today}-TAAAA%` } },
        paranoid: false,
        skipTenantScope: true,
      }),
    );
  });

  it("starts at 0001 when nothing holds the prefix", async () => {
    const number = await Certificate.generateCertificateNumber("X", {
      Certificate: { findOne: jest.fn(async () => null) },
      Sequelize: { Op },
    });

    expect(number).toBe(`CERT-${today}-X-0001`);
  });
});

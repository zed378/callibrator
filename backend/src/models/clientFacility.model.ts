/**
 * ClientFacility Model — a health facility (faskes) served by the tenant, the calibration company
 * (P20-07; ADR-124 and its Amendment 2; spec MEMORY/specs/P19-04-client-facilities.md § 4).
 *
 * TENANT-SCOPED (`tenantId`): the tenant hooks stamp and filter it like every tenant model. It
 * declares NO `clientFacilityId` — it IS the facility; a bound user reaches it only through the
 * `FACILITY_READABLE` own-facility rule (P21-09, AM-8).
 *
 * Every tenant has exactly ONE `isSelf` facility (the self-served hospital's own, and the
 * provider's own devices), created by migration 0117 for the tenants that existed and by
 * services/clientFacility.service#createSelfFacility in every tenant-creation path since. The
 * self facility is always `active`; `isSelf` and `tenantId` never change (0117's trigger).
 *
 * NOT paranoid and NO defaultScope (spec G-F3): an include of a model with a defaultScope is an
 * INNER JOIN (A-75) — every device of a soft-deleted facility would vanish from the provider's
 * lists, and a FK RESTRICT never fires on a soft delete. `ended` is the end of life; a hard delete
 * only of a facility nothing references (the composite foreign keys RESTRICT).
 *
 * The table's CHECKs, unique indexes (`(tenant_id, id)` — the composite-FK target —, code, name,
 * one self per tenant), its list index and its identity trigger are created by migration 0117;
 * none is declared here (db.sync() runs before the migrations at boot — ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import {
  CLIENT_FACILITY_KINDS,
  CLIENT_FACILITY_STATUSES,
  type ClientFacilityKind,
  type ClientFacilityStatus,
} from "@callibrator/contracts/states";
import type { ClientFacilityId, TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A ClientFacility row. Types only: emits nothing. */
interface ClientFacility extends Model<InferAttributes<ClientFacility>, InferCreationAttributes<ClientFacility>> {
  id: CreationOptional<ClientFacilityId>;
  tenantId: TenantId;
  /** Trimmed, inner whitespace collapsed (0117's CHECK); unique per tenant, case-insensitively. */
  name: string;
  /** `^[A-Z0-9][A-Z0-9._-]{0,31}$`; the self facility's is `SELF`; unique per tenant. */
  code: string;
  kind: CreationOptional<ClientFacilityKind>;
  /** Set only by createSelfFacility; never changed (0117's trigger). */
  isSelf: CreationOptional<boolean>;
  status: CreationOptional<ClientFacilityStatus>;
  /** Required by a CHECK whenever `status` is not `active`. */
  statusReason: CreationOptional<string | null>;
  statusChangedAt: CreationOptional<Date | null>;
  statusChangedBy: CreationOptional<UserId | null>;
  address: CreationOptional<string | null>;
  city: CreationOptional<string | null>;
  province: CreationOptional<string | null>;
  postalCode: CreationOptional<string | null>;
  phone: CreationOptional<string | null>;
  /** Personal data of the facility's contact person (UU PDP); optional. */
  contactName: CreationOptional<string | null>;
  contactEmail: CreationOptional<string | null>;
  contactPhone: CreationOptional<string | null>;
  logoStorageKey: CreationOptional<string | null>;
  /** Upstream `mst_faskes.id` (P24-02); never in any response contract. */
  legacyId: CreationOptional<number | null>;
  createdBy: CreationOptional<UserId | null>;
  updatedBy: CreationOptional<UserId | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface ClientFacilityStatics {
  associate: (models: Models) => void;
}

type DefineClientFacility = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<ClientFacility, ClientFacilityStatics>;

/** Define the ClientFacility model on `db`. */
const defineModel: DefineClientFacility = (db, DataTypes) => {
  const user = { model: "users", key: "id" };
  const ClientFacility = initModel<ClientFacility, ClientFacilityStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
      },
      name: { type: DataTypes.STRING(255), allowNull: false },
      code: { type: DataTypes.STRING(32), allowNull: false },
      kind: { type: DataTypes.ENUM(...CLIENT_FACILITY_KINDS), allowNull: false, defaultValue: "other" },
      isSelf: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.ENUM(...CLIENT_FACILITY_STATUSES), allowNull: false, defaultValue: "active" },
      statusReason: { type: DataTypes.STRING(500), allowNull: true },
      statusChangedAt: { type: DataTypes.DATE, allowNull: true },
      statusChangedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      address: { type: DataTypes.STRING(500), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      province: { type: DataTypes.STRING(100), allowNull: true },
      postalCode: { type: DataTypes.STRING(20), allowNull: true },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      contactName: { type: DataTypes.STRING(255), allowNull: true },
      contactEmail: { type: DataTypes.STRING(255), allowNull: true },
      contactPhone: { type: DataTypes.STRING(50), allowNull: true },
      logoStorageKey: { type: DataTypes.STRING(1024), allowNull: true },
      legacyId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      updatedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
    },
    {
      tableName: "client_facilities",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "ClientFacility",
      sequelize: db,
    },
  );

  ClientFacility.associate = (models: Models): void => {
    ClientFacility.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
  };

  return ClientFacility;
};

export = defineModel;

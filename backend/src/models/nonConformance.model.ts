// P9-10 (ADR-087 Amendments 7–8): converted from nonConformance.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
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
  NC_SEVERITIES,
  NC_STATUSES,
  type NcSeverity,
  type NcStatus,
} from "../constants/qmsConstants";
import type { ClientFacilityId, TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A NonConformance row (attributes, included associations, instance methods). Types only: emits nothing. */
interface NonConformance extends Model<
  InferAttributes<NonConformance>,
  InferCreationAttributes<NonConformance>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  ncNumber: string;
  title: string;
  description: string;
  status: CreationOptional<NcStatus>;
  severity: CreationOptional<NcSeverity>;
  reportedBy: UserId;
  deviceId: string | null;

  /**
   * P20-07 (ADR-124 Am. 2): the device's client facility, or NULL exactly when the NC concerns no
   * device (CHECK in migration 0123). The composite key `(tenant_id, client_facility_id, device_id)`
   * → calibration_devices cascades a device move; the database fills it from the device when it is
   * omitted, and clears it when the device link is cleared (ADR-124 Am. 3).
   */
  clientFacilityId: CreationOptional<ClientFacilityId | null>;
  dateIdentified: Date;
  rootCause: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  reporter?: NonAttribute<ModelInstance<"User">>;
  device?: NonAttribute<ModelInstance<"CalibrationDevice">>;
  capas?: NonAttribute<ModelInstance<"Capa">[]>;
}

interface NonConformanceStatics {
  associate(models: Models): void;
}

type DefineNonConformance = (
  sequelize: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<NonConformance, NonConformanceStatics>;

/** Define the NonConformance model (a fresh class per call). */
const defineModel: DefineNonConformance = (sequelize, DataTypes) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class NonConformanceModel extends Model {
    static associate(models: Models): void {
      NonConformance.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
      NonConformance.belongsTo(models.User, {
        foreignKey: "reportedBy",
        as: "reporter",
        onDelete: "RESTRICT",
      });
      NonConformance.belongsTo(models.CalibrationDevice, {
        foreignKey: "deviceId",
        as: "device",
        onDelete: "SET NULL",
      });
      NonConformance.hasMany(models.Capa, {
        foreignKey: "ncId",
        as: "capas",
        onDelete: "RESTRICT",
      });
    }
  }

  const NonConformance = initModel<NonConformance, NonConformanceStatics>(
    NonConformanceModel,
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        field: "tenant_id",
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
      },
      ncNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "nc_number",
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...NC_STATUSES),
        defaultValue: "OPEN",
        allowNull: false,
      },
      severity: {
        type: DataTypes.ENUM(...NC_SEVERITIES),
        defaultValue: "MEDIUM",
        allowNull: false,
      },
      reportedBy: {
        type: DataTypes.UUID,
        field: "reported_by",
        allowNull: false,
      },
      deviceId: {
        type: DataTypes.UUID,
        field: "device_id",
        allowNull: true,
      },
      // P20-07: nullable — NULL exactly when deviceId is (0123's CHECK); filled by the database.
      clientFacilityId: {
        type: DataTypes.UUID,
        field: "client_facility_id",
        allowNull: true,
      },
      dateIdentified: {
        type: DataTypes.DATE,
        field: "date_identified",
        allowNull: false,
      },
      rootCause: {
        type: DataTypes.TEXT,
        field: "root_cause",
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "NonConformance",
      tableName: "non_conformances",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  return NonConformance;
};

export = defineModel;

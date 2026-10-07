/**
 * UpstreamSqlImport — one upload of an upstream SQL dump, and its run into the
 * `upstream_import` staging schema (P24-06; ADR-129).
 *
 * A PLATFORM row, like `access_requests` and `upstream_file_imports`: uploaded
 * and seen only by the super admin. NO tenant column — `notifyTenantId` (the
 * uploader's home tenant, where the completion notification is stored) is
 * deliberately not `tenantId`, so the global hooks never scope the table.
 *
 * Counts only. The row holds sizes, a SHA-256, per-table row counts and
 * reasons, the parser's statement counts and a fixed error code — never a
 * value from the dump, a table's content, or the file's name. `filePath` is the
 * server's own path to the quarantined file; the service never answers it.
 *
 * The table, its ENUM, its CHECKs and its
 * indexes (the single-active-run partial unique index among them) are created
 * by migration 0114; no index is declared here (ADR-100 Am. 3: db.sync() runs
 * before the migrations).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { UPSTREAM_SQL_IMPORT_STATUSES, type UpstreamSqlImportStatus } from "@callibrator/contracts/states";
import {
  UPSTREAM_SQL_IMPORT_COMPRESSIONS,
  UPSTREAM_SQL_IMPORT_DATA_CLASSES,
  UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES,
  type UpstreamSqlImportCompression,
  type UpstreamSqlImportDataClass,
  type UpstreamSqlImportTransformStatus,
} from "@callibrator/contracts/upstreamSqlImport";
import { jsonShape, type UpstreamSqlImportParseSummary, type UpstreamSqlImportTables } from "../utils/jsonShape.util";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An UpstreamSqlImport row. Types only: emits nothing. */
interface UpstreamSqlImport extends Model<InferAttributes<UpstreamSqlImport>, InferCreationAttributes<UpstreamSqlImport>> {
  id: CreationOptional<string>;
  status: CreationOptional<UpstreamSqlImportStatus>;
  dataClass: UpstreamSqlImportDataClass;
  compression: UpstreamSqlImportCompression;
  /** BIGINT: node-postgres returns it as a string. */
  sizeBytes: string | number;
  sha256: string;
  /** The quarantined file on this server; NULL once deleted. Never answered. */
  filePath: CreationOptional<string | null>;
  fileDeletedAt: CreationOptional<Date | null>;
  fileRetainUntil: CreationOptional<Date | null>;
  /** BIGINT: node-postgres returns it as a string. */
  bytesRead: CreationOptional<string | number>;
  /** BIGINT: node-postgres returns it as a string. */
  uncompressedBytes: CreationOptional<string | number>;
  rowsLoaded: CreationOptional<number>;
  rowsRejected: CreationOptional<number>;
  rowsNotExtracted: CreationOptional<number>;
  tables: CreationOptional<UpstreamSqlImportTables | null>;
  parseSummary: CreationOptional<UpstreamSqlImportParseSummary | null>;
  /** A stable code when the run failed (never a raw message). */
  errorCode: CreationOptional<string | null>;
  transformStatus: CreationOptional<UpstreamSqlImportTransformStatus>;
  attempt: CreationOptional<number>;
  batchJobId: CreationOptional<string | null>;
  uploadedBy: string | null;
  /** The uploader's home tenant: where the completion notification is stored. Not a tenant scope. */
  notifyTenantId: string;
  cancelRequestedAt: CreationOptional<Date | null>;
  cancelledBy: CreationOptional<string | null>;
  startedAt: CreationOptional<Date | null>;
  scannedAt: CreationOptional<Date | null>;
  parseStartedAt: CreationOptional<Date | null>;
  finishedAt: CreationOptional<Date | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

interface UpstreamSqlImportStatics {
  associate: (models: Models) => void;
}

type DefineUpstreamSqlImport = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<UpstreamSqlImport, UpstreamSqlImportStatics>;

/** Define the UpstreamSqlImport model on `db`. */
const defineModel: DefineUpstreamSqlImport = (db, DataTypes) => {
  // A fresh definition per attribute: Sequelize normalises an attribute's definition in place.
  const userFk = (): { type: typeof DataTypes.UUID; allowNull: true; references: { model: string; key: string }; onDelete: string } => ({
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: "users", key: "id" },
    onDelete: "SET NULL",
  });
  const UpstreamSqlImport = initModel<UpstreamSqlImport, UpstreamSqlImportStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      status: { type: DataTypes.ENUM(...UPSTREAM_SQL_IMPORT_STATUSES), allowNull: false, defaultValue: "uploaded" },
      dataClass: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: { isIn: [[...UPSTREAM_SQL_IMPORT_DATA_CLASSES]] },
      },
      compression: {
        type: DataTypes.STRING(8),
        allowNull: false,
        validate: { isIn: [[...UPSTREAM_SQL_IMPORT_COMPRESSIONS]] },
      },
      sizeBytes: { type: DataTypes.BIGINT, allowNull: false },
      sha256: { type: DataTypes.STRING(64), allowNull: false },
      filePath: { type: DataTypes.TEXT, allowNull: true },
      fileDeletedAt: { type: DataTypes.DATE, allowNull: true },
      fileRetainUntil: { type: DataTypes.DATE, allowNull: true },
      bytesRead: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      uncompressedBytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      rowsLoaded: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      rowsRejected: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      rowsNotExtracted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      tables: { type: DataTypes.JSONB, allowNull: true, validate: { shape: jsonShape("UpstreamSqlImport.tables") } },
      parseSummary: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("UpstreamSqlImport.parseSummary") },
      },
      errorCode: { type: DataTypes.STRING(64), allowNull: true },
      transformStatus: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "not_available",
        validate: { isIn: [[...UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES]] },
      },
      attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      batchJobId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "batch_jobs", key: "id" },
        onDelete: "SET NULL",
      },
      uploadedBy: userFk(),
      // A routing hint, not a reference: no foreign key (a tenant's removal must not be blocked
      // by, nor delete, the platform's import record), and not `tenantId` (see the header).
      notifyTenantId: { type: DataTypes.UUID, allowNull: false },
      cancelRequestedAt: { type: DataTypes.DATE, allowNull: true },
      cancelledBy: userFk(),
      startedAt: { type: DataTypes.DATE, allowNull: true },
      scannedAt: { type: DataTypes.DATE, allowNull: true },
      parseStartedAt: { type: DataTypes.DATE, allowNull: true },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "upstream_sql_imports",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "UpstreamSqlImport",
      sequelize: db,
    },
  );

  // No association: the list reads no include (the uploader's name is read by id), so there is
  // no defaultScope trap to step on (CLAUDE.md, A-75).
  UpstreamSqlImport.associate = (): void => undefined;

  return UpstreamSqlImport;
};

export = defineModel;

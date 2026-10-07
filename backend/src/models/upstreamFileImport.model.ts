/**
 * UpstreamFileImport — one rsync import of upstream device photos into a tenant's storage (ADR-130;
 * docs/UPSTREAM/08-FILE-POLICY.md).
 *
 * A PLATFORM row, like `access_requests`: started and seen only by the super admin. It names the
 * tenant whose storage the files land in as `targetTenantId`, deliberately NOT `tenantId` — that
 * attribute would make the global hooks scope the table (`tenantScope.util#tenantKeyOf`) to
 * whatever tenant the runner works for, and a platform operation would vanish from its own queue.
 *
 * THE CREDENTIAL. `secretCiphertext` is the SSH password or private key, a KMS envelope
 * (kms.service#encryptData, bound to this row's id as its additional data). It exists only while
 * the import can still run: every terminal transition (completed, failed, cancelled) sets it to
 * NULL and stamps `secretErasedAt` in the same transaction as the status. It never serialises
 * (models/secretAttributes.ts) and the service answers a projection that does not name it.
 *
 * The table, its ENUM, its foreign key to `tenants` and its indexes are created by migration
 * 0113; the indexes are not declared here (ADR-100 Am. 3: db.sync() runs before the migrations).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { UPSTREAM_FILE_IMPORT_STATUSES, type UpstreamFileImportStatus } from "@callibrator/contracts/states";
import { UPSTREAM_AUTH_METHODS, type UpstreamAuthMethod } from "../constants/upstreamFileImport";
import {
  jsonShape,
  type UpstreamImportEstimate,
  type UpstreamImportProgress,
  type UpstreamImportSummary,
} from "../utils/jsonShape.util";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An UpstreamFileImport row. Types only: emits nothing. */
interface UpstreamFileImport extends Model<InferAttributes<UpstreamFileImport>, InferCreationAttributes<UpstreamFileImport>> {
  id: CreationOptional<string>;
  /** The tenant whose storage receives the files (not `tenantId`: see the file header). */
  targetTenantId: string;
  requestedBy: string | null;
  batchJobId: CreationOptional<string | null>;
  status: CreationOptional<UpstreamFileImportStatus>;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  includeFront: boolean;
  includeSerial: boolean;
  authMethod: UpstreamAuthMethod;
  /** KMS envelope of the password or private key; NULL once erased. Never serialised. */
  secretCiphertext: CreationOptional<string | null>;
  secretErasedAt: CreationOptional<Date | null>;
  /** The confirmed host key: its type, base64 blob and `SHA256:` fingerprint. */
  hostKeyType: string;
  hostKey: string;
  hostKeyFingerprint: string;
  /** The operator declared the source synthetic (test data) — the only kind allowed while the DPIA gate is off. */
  syntheticSource: boolean;
  bandwidthLimitKbps: CreationOptional<number | null>;
  estimate: CreationOptional<UpstreamImportEstimate | null>;
  progress: CreationOptional<UpstreamImportProgress | null>;
  summary: CreationOptional<UpstreamImportSummary | null>;
  /** A stable reason code when the import failed (never a raw tool message). */
  errorCode: CreationOptional<string | null>;
  cancelRequestedAt: CreationOptional<Date | null>;
  cancelledBy: CreationOptional<string | null>;
  startedAt: CreationOptional<Date | null>;
  finishedAt: CreationOptional<Date | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

interface UpstreamFileImportStatics {
  associate: (models: Models) => void;
}

type DefineUpstreamFileImport = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<UpstreamFileImport, UpstreamFileImportStatics>;

/** Define the UpstreamFileImport model on `db`. */
const defineModel: DefineUpstreamFileImport = (db, DataTypes) => {
  const UpstreamFileImport = initModel<UpstreamFileImport, UpstreamFileImportStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      // NOT declared as a model reference: every model foreign key to `tenants` is the Q-16
      // tenant column, which this is not. Migration 0113 adds the constraint (CASCADE).
      targetTenantId: { type: DataTypes.UUID, allowNull: false },
      requestedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      batchJobId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "batch_jobs", key: "id" },
        onDelete: "SET NULL",
      },
      status: { type: DataTypes.ENUM(...UPSTREAM_FILE_IMPORT_STATUSES), allowNull: false, defaultValue: "pending" },
      host: { type: DataTypes.STRING(253), allowNull: false },
      port: { type: DataTypes.INTEGER, allowNull: false },
      username: { type: DataTypes.STRING(32), allowNull: false },
      remotePath: { type: DataTypes.STRING(1024), allowNull: false },
      includeFront: { type: DataTypes.BOOLEAN, allowNull: false },
      includeSerial: { type: DataTypes.BOOLEAN, allowNull: false },
      authMethod: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: { isIn: [[...UPSTREAM_AUTH_METHODS]] },
      },
      secretCiphertext: { type: DataTypes.TEXT, allowNull: true },
      secretErasedAt: { type: DataTypes.DATE, allowNull: true },
      hostKeyType: { type: DataTypes.STRING(64), allowNull: false },
      hostKey: { type: DataTypes.TEXT, allowNull: false },
      hostKeyFingerprint: { type: DataTypes.STRING(128), allowNull: false },
      syntheticSource: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      bandwidthLimitKbps: { type: DataTypes.INTEGER, allowNull: true },
      estimate: { type: DataTypes.JSONB, allowNull: true, validate: { shape: jsonShape("UpstreamFileImport.estimate") } },
      progress: { type: DataTypes.JSONB, allowNull: true, validate: { shape: jsonShape("UpstreamFileImport.progress") } },
      summary: { type: DataTypes.JSONB, allowNull: true, validate: { shape: jsonShape("UpstreamFileImport.summary") } },
      errorCode: { type: DataTypes.STRING(64), allowNull: true },
      cancelRequestedAt: { type: DataTypes.DATE, allowNull: true },
      cancelledBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      startedAt: { type: DataTypes.DATE, allowNull: true },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "upstream_file_imports",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "UpstreamFileImport",
      sequelize: db,
    },
  );

  // No association: the queue reads no include (the requester's name is not shown), so there
  // is no defaultScope trap to step on (CLAUDE.md, A-75). The key is read by id where needed.
  UpstreamFileImport.associate = (): void => undefined;

  return UpstreamFileImport;
};

export = defineModel;

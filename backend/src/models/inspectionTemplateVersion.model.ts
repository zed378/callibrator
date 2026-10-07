/**
 * InspectionTemplateVersion Model — one version of a checklist template; the
 * id an IPM session pins (P20-03; ADR-125 and its Amendment 1; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.4, § 7.2 – 7.7).
 *
 * draft → published → retired, or draft → discarded. `versionNumber`,
 * `contentHash` (SHA-256 of `canonicalTemplateVersion`, @callibrator/contracts),
 * `changeNote` and the publication are set together at publish; a published
 * version names EXACTLY ONE publisher — `publishedBy` (a user) or
 * `publishedBySystem` (a `system:` actor, e.g. `system:catalogue-seed`).
 * `revision` is the draft's optimistic-concurrency counter, frozen after
 * publish.
 *
 * Held by the DATABASE, not only the service (migration 0112): at most one
 * published and one draft per template (partial UNIQUE indexes); a published
 * version's only permitted UPDATE is its retirement; retired and discarded are
 * final; nothing is deleted — a trigger for every role, ENABLE ALWAYS. The
 * service's own 409 must fire before the trigger (spec § 7.7).
 *
 * GLOBAL; NOT paranoid, NO defaultScope (G-4); NO association to a tenant
 * model (ADR-125 § 7) — the user columns are foreign keys, never includes (a
 * `User` include from a global model would cross the tenant hooks, and no
 * actor is returned to tenants, spec § 8.3).
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
import { TEMPLATE_VERSION_STATUSES, type TemplateVersionStatus } from "@callibrator/contracts/states";
import type { InspectionTemplateId, InspectionTemplateVersionId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An InspectionTemplateVersion row. Types only: emits nothing. */
interface InspectionTemplateVersion extends Model<
  InferAttributes<InspectionTemplateVersion>,
  InferCreationAttributes<InspectionTemplateVersion>
> {
  id: CreationOptional<InspectionTemplateVersionId>;
  templateId: InspectionTemplateId;
  status: CreationOptional<TemplateVersionStatus>;
  /** Assigned at publish as max + 1 per template; NULL on drafts and discarded drafts. */
  versionNumber: CreationOptional<number | null>;
  /** On a TYPE version: the base version materialised into it. NULL on the base's own versions. */
  baseVersionId: CreationOptional<InspectionTemplateVersionId | null>;
  /** On a version created by a base rebase (spec § 7.3): the version it replaced. */
  rebasedFromVersionId: CreationOptional<InspectionTemplateVersionId | null>;
  /** Lower-case hex SHA-256 of the canonical content; set at publish. */
  contentHash: CreationOptional<string | null>;
  /** 3–2000 characters; required to publish. */
  changeNote: CreationOptional<string | null>;
  revision: CreationOptional<number>;
  publishedAt: CreationOptional<Date | null>;
  publishedBy: CreationOptional<UserId | null>;
  /** A `system:` actor (SYSTEM_ACTORS) when no user published it — the seed, the import. */
  publishedBySystem: CreationOptional<string | null>;
  retiredAt: CreationOptional<Date | null>;
  retiredBy: CreationOptional<UserId | null>;
  discardedAt: CreationOptional<Date | null>;
  discardedBy: CreationOptional<UserId | null>;
  createdBy: CreationOptional<UserId | null>;
  updatedBy: CreationOptional<UserId | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  template?: NonAttribute<ModelInstance<"InspectionTemplate">>;
  baseVersion?: NonAttribute<InspectionTemplateVersion | null>;
  rebasedFrom?: NonAttribute<InspectionTemplateVersion | null>;
  items?: NonAttribute<ModelInstance<"InspectionTemplateItem">[]>;
}

interface InspectionTemplateVersionStatics {
  associate: (models: Models) => void;
}

type DefineInspectionTemplateVersion = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionTemplateVersion, InspectionTemplateVersionStatics>;

/** Define the InspectionTemplateVersion model on `db`. */
const defineModel: DefineInspectionTemplateVersion = (db, DataTypes) => {
  const user = { model: "users", key: "id" };
  const version = { model: "inspection_template_versions", key: "id" };
  const InspectionTemplateVersion = initModel<InspectionTemplateVersion, InspectionTemplateVersionStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      templateId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "inspection_templates", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      status: { type: DataTypes.ENUM(...TEMPLATE_VERSION_STATUSES), allowNull: false, defaultValue: "draft" },
      versionNumber: { type: DataTypes.INTEGER, allowNull: true },
      baseVersionId: { type: DataTypes.UUID, allowNull: true, references: version, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      rebasedFromVersionId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: version,
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      contentHash: { type: DataTypes.CHAR(64), allowNull: true },
      changeNote: { type: DataTypes.TEXT, allowNull: true },
      revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
      publishedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      publishedBySystem: { type: DataTypes.STRING(64), allowNull: true },
      retiredAt: { type: DataTypes.DATE, allowNull: true },
      retiredBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      discardedAt: { type: DataTypes.DATE, allowNull: true },
      discardedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      createdBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      updatedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
    },
    {
      tableName: "inspection_template_versions",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "InspectionTemplateVersion",
      sequelize: db,
    },
  );

  InspectionTemplateVersion.associate = (models: Models): void => {
    // Global → global only (ADR-125 § 7).
    InspectionTemplateVersion.belongsTo(models.InspectionTemplate, {
      foreignKey: "templateId",
      as: "template",
      onDelete: "RESTRICT",
    });
    InspectionTemplateVersion.belongsTo(models.InspectionTemplateVersion, {
      foreignKey: "baseVersionId",
      as: "baseVersion",
      onDelete: "RESTRICT",
    });
    InspectionTemplateVersion.belongsTo(models.InspectionTemplateVersion, {
      foreignKey: "rebasedFromVersionId",
      as: "rebasedFrom",
      onDelete: "RESTRICT",
    });
    InspectionTemplateVersion.hasMany(models.InspectionTemplateItem, {
      foreignKey: "versionId",
      as: "items",
      onDelete: "RESTRICT",
    });
  };

  return InspectionTemplateVersion;
};

export = defineModel;

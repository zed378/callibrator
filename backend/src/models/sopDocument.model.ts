// P9-10 (ADR-087 Amendments 7–8): converted from sopDocument.model.js with no behaviour
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
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const SOP_DOCUMENT_STATUSES = [
  "DRAFT",
  "UNDER_REVIEW",
  "PUBLISHED",
  "ARCHIVED",
] as const;

/** A SopDocument row (attributes, included associations, instance methods). Types only: emits nothing. */
interface SopDocument extends Model<
  InferAttributes<SopDocument>,
  InferCreationAttributes<SopDocument>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  documentNumber: string;
  title: string;
  version: CreationOptional<string>;
  contentUrl: string | null;
  status: CreationOptional<(typeof SOP_DOCUMENT_STATUSES)[number]>;
  authorId: UserId;
  publishedDate: Date | null;
  requiresTraining: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  author?: NonAttribute<ModelInstance<"User">>;
  acknowledgments?: NonAttribute<ModelInstance<"SopTrainingAcknowledgment">[]>;
}

interface SopDocumentStatics {
  associate(models: Models): void;
}

type DefineSopDocument = (
  sequelize: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<SopDocument, SopDocumentStatics>;

/** Define the SopDocument model (a fresh class per call). */
const defineModel: DefineSopDocument = (sequelize, DataTypes) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class SopDocumentModel extends Model {
    static associate(models: Models): void {
      SopDocument.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
      SopDocument.belongsTo(models.User, {
        foreignKey: "authorId",
        as: "author",
        onDelete: "RESTRICT",
      });
      SopDocument.hasMany(models.SopTrainingAcknowledgment, {
        foreignKey: "documentId",
        as: "acknowledgments",
        onDelete: "RESTRICT",
      });
    }
  }

  const SopDocument = initModel<SopDocument, SopDocumentStatics>(
    SopDocumentModel,
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
      documentNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "document_number",
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      version: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "1.0",
      },
      contentUrl: {
        type: DataTypes.STRING,
        field: "content_url",
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...SOP_DOCUMENT_STATUSES),
        defaultValue: "DRAFT",
        allowNull: false,
      },
      authorId: {
        type: DataTypes.UUID,
        field: "author_id",
        allowNull: false,
      },
      publishedDate: {
        type: DataTypes.DATE,
        field: "published_date",
        allowNull: true,
      },
      requiresTraining: {
        type: DataTypes.BOOLEAN,
        field: "requires_training",
        defaultValue: true,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "SopDocument",
      tableName: "sop_documents",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  return SopDocument;
};

export = defineModel;

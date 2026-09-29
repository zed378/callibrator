/**
 * DocumentChunk Model — RAG knowledge base
 *
 * A chunk of a tenant document (SOP, post, etc.) with its vector embedding, used
 * for retrieval-augmented AI answers. The `embedding` column is intentionally
 * NOT declared as an ORM attribute: on Postgres it is a pgvector `vector(1536)`
 * column written/queried via raw SQL (Sequelize has no native vector type), so
 * keeping it off the model avoids the ORM trying to select/parse it. The model
 * still serves tenant-scoped metadata reads and the non-pgvector recency
 * fallback (content only).
 */
// P9-10 (ADR-087 Amendments 7–8): converted from documentChunk.model.js with no behaviour
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
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A DocumentChunk row (attributes, included associations, instance methods). Types only: emits nothing. */
interface DocumentChunk extends Model<
  InferAttributes<DocumentChunk>,
  InferCreationAttributes<DocumentChunk>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  sourceType: string;
  sourceId: string;
  chunkIndex: CreationOptional<number>;
  content: string;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
}

interface DocumentChunkStatics {
  associate: (models: Models) => void;
}

type DefineDocumentChunk = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<DocumentChunk, DocumentChunkStatics>;

/** Define the DocumentChunk model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineDocumentChunk = (db, DataTypes) => {
  const DocumentChunk = initModel<DocumentChunk, DocumentChunkStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      sourceType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "Origin entity type, e.g. SopDocument, Post",
      },
      sourceId: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      chunkIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
    },
    {
      tableName: "document_chunks",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["source_type", "source_id"] },
      ],
      modelName: "DocumentChunk",
      sequelize: db,
    },
  );

  DocumentChunk.associate = (models: Models): void => {
    DocumentChunk.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return DocumentChunk;
};

export = defineModel;

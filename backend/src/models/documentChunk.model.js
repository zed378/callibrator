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

const defineModel = (db, DataTypes) => {
  const DocumentChunk = db.define(
    "DocumentChunk",
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
    },
  );

  DocumentChunk.associate = (models) => {
    DocumentChunk.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  return DocumentChunk;
};

module.exports = defineModel;

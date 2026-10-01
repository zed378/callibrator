/**
 * Create the RAG document-chunk store.
 *
 * ai.service.queryDocuments previously answered from a hardcoded "Simulated
 * document context" string against a SopDocuments.embedding column that does not
 * exist. This creates a real chunk table with a pgvector embedding column and a
 * cosine-distance index so retrieval is genuine.
 *
 * Engine-aware: on Postgres the embedding is a `vector(1536)` column (enabling
 * the `vector` extension first) with an ivfflat index; on other engines it falls
 * back to a TEXT column (semantic search degrades to a recency fallback in the
 * service). Verify the extension/column in psql afterward.
 */
import { DataTypes, Sequelize } from "sequelize";
import type { QueryInterface } from "sequelize";

/**
 * The QueryInterface Umzug passes. `context.queryInterface || context` below is
 * the reviewed fallback frozen by D-29 (ADR-083): a real QueryInterface has no
 * `.queryInterface`, so it always takes `context`. It is kept as written.
 */
type Context = QueryInterface & { queryInterface?: QueryInterface };

const EMBEDDING_DIMS = 1536; // text-embedding-3-small

export = {
  up: async ({ context }: { context: Context }): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;
    const dialect = queryInterface.sequelize.getDialect();

    // showAllTables is typed string[]; a dialect may return { tableName } objects.
    const existing = ((await queryInterface.showAllTables()) as (string | { tableName: string })[]).map((t) =>
      (typeof t === "object" ? t.tableName : t).toLowerCase(),
    );

    if (dialect === "postgres") {
      await queryInterface.sequelize
        .query("CREATE EXTENSION IF NOT EXISTS vector;")
        .catch(() => undefined);
    }

    if (!existing.includes("document_chunks")) {
      await queryInterface.createTable("document_chunks", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "tenants", key: "id" },
          onDelete: "CASCADE",
        },
        source_type: { type: DataTypes.STRING(100), allowNull: false },
        source_id: { type: DataTypes.STRING(255), allowNull: false },
        chunk_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        content: { type: DataTypes.TEXT, allowNull: false },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.addIndex("document_chunks", ["tenant_id"]);
      await queryInterface.addIndex("document_chunks", ["source_type", "source_id"]);
    }

    // Embedding column: real pgvector on Postgres, TEXT elsewhere.
    if (dialect === "postgres") {
      await queryInterface.sequelize.query(
        `ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(${String(EMBEDDING_DIMS)});`,
      );
      await queryInterface.sequelize
        .query(
          "CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding " +
            "ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);",
        )
        .catch(() => undefined);
    } else {
      const table = await queryInterface.describeTable("document_chunks");
      if (!table["embedding"]) {
        await queryInterface.addColumn("document_chunks", "embedding", {
          type: DataTypes.TEXT,
          allowNull: true,
        });
      }
    }
  },

  down: async ({ context }: { context: Context }): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;
    await queryInterface.dropTable("document_chunks").catch(() => undefined);
  },
};

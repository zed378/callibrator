/**
 * Backfill the RAG document-chunk store from existing tenant documents.
 *
 * Usage: node src/scripts/backfillEmbeddings.js
 *
 * Runs with no request/tenant CLS context, so the isolation hooks run unscoped
 * and each ingest confines itself with the explicit tenantId it is given. For
 * every tenant it ingests the text it can reach today (SOP document titles —
 * SopDocument stores a contentUrl rather than inline body, so richer ingestion
 * should call aiService.ingestDocument with the fetched document text once a
 * content pipeline exists). Idempotent: ingestDocument replaces prior chunks for
 * the same source.
 */

/* istanbul ignore file -- operational backfill script, run manually */

const aiService = require("../services/ai.service");
const { logger } = require("../middlewares/activityLog.middleware");

async function backfill() {
  const { Tenant, SopDocument } = require("../models");

  const tenants = await Tenant.findAll({ attributes: ["id"] });
  const summary = { tenants: tenants.length, sources: 0, chunks: 0, errors: 0 };

  for (const tenant of tenants) {
    let sops = [];
    try {
      sops = await SopDocument.findAll({ where: { tenantId: tenant.id } });
    } catch (err) {
      summary.errors += 1;
      logger.error(`Backfill: failed to load SOPs for tenant ${tenant.id}: ${err.message}`);
      continue;
    }

    for (const sop of sops) {
      const content = [sop.title, sop.version].filter(Boolean).join("\n");
      if (!content.trim()) {
        continue;
      }
      try {
        const result = await aiService.ingestDocument(tenant.id, {
          sourceType: "SopDocument",
          sourceId: sop.id,
          content,
        });
        summary.sources += 1;
        summary.chunks += result.chunks;
      } catch (err) {
        summary.errors += 1;
        logger.error(`Backfill: failed to ingest SOP ${sop.id}: ${err.message}`);
      }
    }
  }

  logger.info("Embedding backfill complete", summary);
  return summary;
}

if (require.main === module) {
  backfill()
    .then((s) => {
      // eslint-disable-next-line no-console
      console.log("Backfill done:", s);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Backfill failed:", err.message);
      process.exit(1);
    });
}

module.exports = { backfill };

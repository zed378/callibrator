/**
 * Backfill the RAG document-chunk store from existing tenant documents.
 *
 * Usage: tsx src/scripts/backfillEmbeddings.ts
 *
 * Runs with no request/tenant CLS context, so the isolation hooks run unscoped
 * and each ingest confines itself with the explicit tenantId it is given. For
 * every tenant it ingests the text it can reach today (SOP document titles —
 * SopDocument stores a contentUrl rather than inline body, so richer ingestion
 * should call aiService.ingestDocument with the fetched document text once a
 * content pipeline exists). Idempotent: ingestDocument replaces prior chunks for
 * the same source.
 *
 * P9-21 (ADR-087): converted from backfillEmbeddings.js with no behaviour
 * change. `export =` keeps the exact object `require()` returned; the models
 * are still required inside `backfill`, at call time; it runs only when it is
 * the entry module, as before.
 */
// A-42 console-allowed: a CLI run by hand in a terminal; its console output is the operator's report, not application logging (backend/src/tests/guards/noConsole.a42.test.js).

/* istanbul ignore file -- operational backfill script, run manually */

import aiService from "../services/ai.service";
import { logger } from "../middlewares/activityLog.middleware";
import type Models from "../models";
import type { ModelInstance } from "../types/models";

/** What a backfill did. */
interface BackfillSummary {
  tenants: number;
  sources: number;
  chunks: number;
  errors: number;
}

const messageOf = (err: unknown): string => String((err as { message?: unknown }).message);

async function backfill(): Promise<BackfillSummary> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded at call time
  const { Tenant, SopDocument } = require("../models") as typeof Models;

  const tenants = await Tenant.findAll({ attributes: ["id"] });
  const summary: BackfillSummary = { tenants: tenants.length, sources: 0, chunks: 0, errors: 0 };

  for (const tenant of tenants) {
    let sops: ModelInstance<"SopDocument">[] = [];
    try {
      sops = await SopDocument.findAll({ where: { tenantId: tenant.id } });
    } catch (err) {
      summary.errors += 1;
      logger.error(`Backfill: failed to load SOPs for tenant ${tenant.id}: ${messageOf(err)}`);
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
        logger.error(`Backfill: failed to ingest SOP ${sop.id}: ${messageOf(err)}`);
      }
    }
  }

  logger.info("Embedding backfill complete", summary);
  return summary;
}

if (require.main === module) {
  backfill()
    .then((s) => {
      console.log("Backfill done:", s);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Backfill failed:", (err as { message?: unknown }).message);
      process.exit(1);
    });
}

export = { backfill };

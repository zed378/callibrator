/**
 * Step 9's files for one transform (P24-03; ADR-129 Am. 10): the photo catalogue of every completed
 * image import into the provider tenant (photoFiles.ts#catalogueOf, oldest first), and the
 * tenant's storage — facility-keyed puts, reads of the ingested objects, and the clean-up the
 * transform's outcome decides (`settle`): a commit removes the re-keyed tenant-scope originals, a
 * rollback removes everything the step wrote. Both are best effort: a leftover object has no row,
 * so it is never served, and the count is logged.
 */
import crypto from "crypto";
import fs from "fs";
import models from "../../models";
import storage from "../storage";
import storedFile from "../storedFile.service";
import { logger } from "../../middlewares/activityLog.middleware";
import { importPaths } from "../upstreamFileImport/workspace";
import { catalogueOf, type TransformFiles } from "./transform/photoFiles";

/** The image imports read per transform (as `previouslyIngested` bounds its read). */
const MAX_IMPORTS = 1000;

/** The manifests' texts of the tenant's completed image imports, oldest first; a removed manifest is skipped. */
export const manifestsOf = async (tenantId: string): Promise<string[]> => {
  const imports = await models.UpstreamFileImport.findAll({
    where: { targetTenantId: tenantId, status: "completed" },
    attributes: ["id"],
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"],
    ],
    limit: MAX_IMPORTS,
  });
  const texts: string[] = [];
  for (const { id } of imports) {
    try {
      texts.push(await fs.promises.readFile(importPaths(id, "").manifest, "utf8"));
    } catch {
      // its manifest was removed: its files read as missing
    }
  }
  return texts;
};

/** The files of one transform into `tenantId`. */
export const loadTransformFiles = async (tenantId: string): Promise<TransformFiles> => {
  const scoped = await storage.getTenantStorage(tenantId);
  return {
    catalogue: catalogueOf(await manifestsOf(tenantId)),
    buildKey: (name, clientFacilityId) => scoped.buildKey({ domain: "attachments", name, clientFacilityId }),
    readObject: (key) => storedFile.readObject(scoped, key),
    putObject: async (key, bytes, contentType) => {
      await scoped.put(key, bytes, { contentType });
    },
    removeObject: (key) => storedFile.removeObject(scoped, key),
    newId: () => crypto.randomUUID(),
    created: [],
    superseded: [],
  };
};

/**
 * After the transform: on commit remove the re-keyed tenant-scope originals (the image import built
 * no derivatives of them, 08 § 11), on rollback remove what the step wrote.
 * @returns how many objects could not be removed
 */
export const settleTransformFiles = async (files: TransformFiles, committed: boolean): Promise<number> => {
  const keys = committed ? files.superseded : files.created;
  let failed = 0;
  for (const key of keys) {
    try {
      await files.removeObject(key);
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) {
    logger.warn("Upstream transform: objects left behind", { committed, failed });
  }
  return failed;
};

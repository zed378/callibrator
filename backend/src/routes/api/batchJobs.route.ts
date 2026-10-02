/**
 * Background jobs: `/api/v1/jobs` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from batchJobs.route.js. Every route and
 * middleware is in the same order as before (checked against the mounted route
 * table). The contract is code-first: batchJobs.openapi.ts (P9-25, ADR-103);
 * the `@swagger` JSDoc this file carried is gone. The controller is now
 * imported before the two gates are built (imports are hoisted); building a
 * gate has no effect beyond its closure.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";
import {
  createTestJob,
  getJobs,
  getJobStatus,
} from "../../controllers/batchJob.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// AZ-01 (G-05): `auth` alone let every role list the tenant's jobs and enqueue
// work. Reads need the seeded `batch-jobs` menu; enqueueing a job needs write.
const canRead = dynamicAccess(MENU_SLUGS.BATCH_JOBS, "read");
const canWrite = dynamicAccess(MENU_SLUGS.BATCH_JOBS, "write");

router.use(auth);

router.get("/", canRead, getJobs);

router.get("/:id", canRead, getJobStatus);

router.post("/test", canWrite, createTestJob);

export = router;

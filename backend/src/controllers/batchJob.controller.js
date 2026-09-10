const batchJobService = require("../services/batchJob.service");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");

exports.createTestJob = asyncHandlerWithMapping(async (req, res) => {
  const { type, totalItems } = req.body;
  const result = await batchJobService.createJob(req.user.tenantId, req.user.id, type || "EXPORT_CSV", totalItems || 10);
  return {
    success: true,
    status: 201,
    message: "Background job created",
    data: result,
  };
}, {});

exports.getJobs = asyncHandlerWithMapping(async (req, res) => {
  const { page, limit } = req.query;
  const result = await batchJobService.getJobs(req.user.tenantId, page, limit);
  return {
    success: true,
    status: 200,
    message: "Jobs retrieved successfully",
    data: result,
  };
}, {});

exports.getJobStatus = asyncHandlerWithMapping(async (req, res) => {
  const result = await batchJobService.getJobStatus(req.user.tenantId, req.params.id);
  return {
    success: true,
    status: 200,
    message: "Job status retrieved",
    data: result,
  };
}, {
  "Job not found": 404,
});

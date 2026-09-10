const sopService = require("../services/sop.service");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");

exports.createDocument = asyncHandlerWithMapping(async (req, res) => {
  const result = await sopService.createDocument(req.user.tenantId, req.user.id, req.body);
  return {
    success: true,
    status: 201,
    message: "Document created successfully",
    data: result,
  };
}, {});

exports.getDocuments = asyncHandlerWithMapping(async (req, res) => {
  const { page, limit, status } = req.query;
  const { documents, total, page: currentPage, limit: pageLimit, totalPages } =
    await sopService.getDocuments(req.user.tenantId, page, limit, status);
  return {
    success: true,
    status: 200,
    message: "Documents retrieved successfully",
    // House envelope: rows in `data`, pagination in a top-level `meta` sibling.
    data: documents,
    meta: { total, page: currentPage, limit: pageLimit, totalPages },
  };
}, {});

exports.publishDocument = asyncHandlerWithMapping(async (req, res) => {
  const result = await sopService.publishDocument(req.user.tenantId, req.params.id);
  return {
    success: true,
    status: 200,
    message: "Document published and training tasks assigned",
    data: result,
  };
}, {
  "Document not found": 404,
});

exports.acknowledgeTraining = asyncHandlerWithMapping(async (req, res) => {
  const result = await sopService.acknowledgeTraining(req.user.tenantId, req.user.id, req.params.id);
  return {
    success: true,
    status: 200,
    message: "Training acknowledged successfully",
    data: result,
  };
}, {
  "Training acknowledgment not found": 404,
});

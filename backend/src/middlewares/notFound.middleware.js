const { notFound: sendNotFound } = require("../utils/response.util");

/**
 * 404 Not Found Middleware
 * Handles routes that don't match any defined endpoint
 */
exports.notFound = (req, res) => {
  sendNotFound(res, "Route not found");
};

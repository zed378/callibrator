/**
 * Q-08 (ADR-084) — the caller's own sessions: list them, end one.
 * Acts only on req.user.id; see services/ownSessions.service.js.
 */
const ownSessions = require("../services/ownSessions.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { auditActor } = require("../utils/auditActor.util");
const { sendResult } = require("../utils/response.util");

exports.listOwnSessions = asyncHandler(async (req, res) => {
  sendResult(res, await ownSessions.listOwnSessions(req.user.id, req.sessionId || null));
});

exports.revokeOwnSession = asyncHandler(async (req, res) => {
  sendResult(
    res,
    await ownSessions.revokeOwnSession(req.user, req.params.id, req.sessionId || null, auditActor(req)),
  );
});

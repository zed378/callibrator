// P9-19 (ADR-087): converted from notFound.middleware.js with no behaviour
// change. The .js destructured `notFound` from response.util at load; the
// const below captures it at load the same way.
import type { Request, Response } from "express";
import { notFound as responseNotFound } from "../utils/response.util";

const sendNotFound = responseNotFound;

/**
 * 404 Not Found Middleware
 * Handles routes that don't match any defined endpoint
 */
export const notFound = (_req: Request, res: Response): void => {
  sendNotFound(res, "Route not found");
};

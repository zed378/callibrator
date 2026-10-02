/**
 * AI features, `/api/v1/ai`: certificate OCR and SOP question answering.
 *
 * P9-18 (ADR-087): converted from ai.controller.js, behaviour unchanged. The
 * service instance is read through its module object at call time; `success`,
 * `asyncHandlerWithMapping` and `AppError` are captured at load, as the `.js`
 * destructured them. `req.user` is read without a guard (`auth` runs first),
 * and `req.file` is multer's (`uploadToMemory` on the route). `export =` keeps
 * the exact object `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import aiService from "../services/ai.service";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
import { AppError as LoadedAppError } from "../utils/appError.util";

const success = loadedSuccess;
const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;
const AppError = LoadedAppError;

/** The principal `auth` set (read without a guard, as before). */
interface AiPrincipal {
  tenantId: string;
}

/** The file multer buffered (`uploadToMemory`). */
interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
}

// ---------------------------------------------------------------------------
// A-281 (ADR-094) — a missing AI provider is a state of the tenant, not a
// server fault. Both endpoints used to answer 500 "failed or AI not
// configured" for it, which pages whoever watches 5xx and tells the caller
// nothing. Now:
//  - no provider configured  -> 409, naming what to configure (the caller's
//    administrator can change it; retrying cannot);
//  - the provider was asked and failed -> 502 (an upstream failure: the
//    request was well formed and the configuration present).
// ---------------------------------------------------------------------------
const AI_NOT_CONFIGURED =
  "No AI provider is configured for this organisation, so AI features are off. " +
  "An administrator can enable them by setting the AI API key (ai_api_key, with " +
  "ai_base_url and ai_vendor if not OpenAI) in the organisation's settings.";

const assertAiConfigured = async (tenantId: string): Promise<void> => {
  const config = await aiService.getAiConfig(tenantId);
  if (!config.apiKey) {
    throw new AppError(409, AI_NOT_CONFIGURED);
  }
};

const processOcr = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(400, "File is required for OCR");
    }

    await assertAiConfigured((req.user as AiPrincipal).tenantId);
    const { buffer, mimetype } = req.file as UploadedFile;
    const result = await aiService.processCertificateOcr((req.user as AiPrincipal).tenantId, buffer, mimetype);

    if (!result) {
      throw new AppError(502, "The AI provider did not return an OCR result. Try again later.");
    }

    success(res, result, null, "OCR extraction successful", 200);
  },
  {},
);

const queryRAG = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
    const { question } = (req.body || {}) as { question?: string };
    if (!question) {
      throw new AppError(400, "Question is required");
    }

    await assertAiConfigured((req.user as AiPrincipal).tenantId);
    const result = await aiService.queryDocuments((req.user as AiPrincipal).tenantId, question);

    if (!result) {
      throw new AppError(502, "The AI provider did not return an answer. Try again later.");
    }

    success(res, { answer: result }, null, "RAG query successful", 200);
  },
  {},
);

const controller = { AI_NOT_CONFIGURED, processOcr, queryRAG };

export = controller;

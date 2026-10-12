/**
 * A transform that failed for a stated reason (P24-01; its code goes on the run). Its own module
 * so a step (steps.ts → a step module) can throw it without importing the runner, which imports
 * the steps (P24-02a).
 */
import type { UpstreamSqlImportTransformErrorCode } from "@callibrator/contracts/upstreamSqlImport";

/** A transform that failed for a stated reason (its code goes on the run). */
export class TransformFailure extends Error {
  readonly code: UpstreamSqlImportTransformErrorCode;

  constructor(code: UpstreamSqlImportTransformErrorCode, message: string) {
    super(message);
    this.name = "TransformFailure";
    this.code = code;
  }
}

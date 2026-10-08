/**
 * An operational error that carries a machine-readable `code` (and, rarely, a few more top-level
 * fields) to the client — P21-03 (P19-02 spec § 7: the IPM 409s; § 9.2: the idempotency 409s;
 * ADR-127 § 8: the offline outbox explains each refusal by its code).
 *
 * The controller wrapper sends `publicCode` as the response's TOP-LEVEL `code` (ADR-100, the
 * `LOCATION_REQUIRED` precedent) and `publicFields` beside it — ids the CALLER may already read
 * (its own draft's id, the head of a chain in its scope), never another principal's.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { AppError } from "./appError.util";

/** A top-level field a coded error may add: an id or a short token, never free text. */
export type PublicFields = Readonly<Record<string, string>>;

export class CodedError extends AppError {
  readonly publicCode: string;
  readonly publicFields: PublicFields;

  /**
   * @param status - the HTTP status (a 4xx)
   * @param code - UPPER_SNAKE, e.g. `IPM_NOT_DRAFT`
   * @param message - the state explanation
   * @param fields - extra top-level fields (ids the caller may read)
   */
  constructor(status: number, code: string, message: string, fields: PublicFields = {}) {
    super(status, message);
    this.publicCode = code;
    this.publicFields = fields;
  }
}

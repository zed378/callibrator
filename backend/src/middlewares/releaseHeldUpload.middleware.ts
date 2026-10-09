/**
 * P21-02b (ADR-132 Am. 3): for a route whose service READS a quarantined upload and stores its own
 * objects (the device photos), the quarantine copy is removed when the response ends — whatever
 * ended it: the 201, a validation 400 after multer, a 404 for a foreign device, a refusal, an
 * idempotent replay. A refused upload leaves nothing behind (A-97, S-17), without each exit path
 * having to remember it; the quarantine sweep (S-33) stays the backstop for a crashed process.
 *
 * Named exports only.
 */
import fs from "fs";
import type { NextFunction, Request, Response } from "express";
import { assertInQuarantine } from "../utils/upload.util";

/** Remove `req.file` from the quarantine once the response has finished or the client went away. */
export const releaseHeldUpload = (req: Request, res: Response, next: NextFunction): void => {
  const held = req.file?.path;
  if (held) {
    // Only a file IN the quarantine is ever removed here (the S-17 guard throws otherwise).
    assertInQuarantine(held);
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        // A callback, not a promise: nothing to await, and an error (already gone) is nothing to do.
        fs.rm(held, { force: true }, () => undefined);
      }
    };
    res.once("finish", release);
    res.once("close", release);
  }
  next();
};

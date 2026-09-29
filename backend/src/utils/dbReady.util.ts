// P9-09 (ADR-087 Amendment 2): converted from dbReady.util.js with no behaviour
// change. The .js required sequelize here for a JSDoc type only; the bare
// import keeps that module load exactly where it was.
import "sequelize";
import { logger } from "../middlewares/activityLog.middleware";

/** What this helper needs of a Sequelize instance (tests pass a stand-in). */
export interface DbProbe {
  authenticate(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
}

/** Retry settings; `attempt` is the internal counter — do not set it. */
export interface WaitForDbReadyOptions {
  maxAttempts?: number;
  delayMs?: number;
  attempt?: number;
}

/**
 * Recursively checks whether the Sequelize instance can talk to the DB.
 *
 * @param sequelize - the Sequelize instance you want to test.
 * @param opts - maxAttempts (default 10), delayMs (default 2000), attempt (internal).
 * @returns resolves with a ready-message or rejects with an error.
 */
async function waitForDbReady(
  sequelize: DbProbe,
  { maxAttempts = 10, delayMs = 2000, attempt = 0 }: WaitForDbReadyOptions = {},
): Promise<string> {
  if (attempt >= maxAttempts) {
    const err = new Error(
      `Database not ready after ${String(maxAttempts)} attempts (last delay ${String(delayMs)}ms)`,
    );
    logger.error(`❌ ${err.message}`);
    return Promise.reject(err);
  }

  try {
    await sequelize.authenticate();

    await sequelize.query("SELECT 1");

    const msg = `✅ Database connection established (attempt ${String(attempt + 1)})`;
    logger.info(msg);
    // eslint-disable-next-line @typescript-eslint/return-await -- as built; the promise is already resolved, so no rejection can escape the try
    return Promise.resolve(msg);
  } catch (err: unknown) {
    // As built: reads `.message` of whatever was thrown (a TypeError for a
    // thrown null, "undefined" for a thrown string), interpolated as is.
    logger.warn(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: interpolates whatever `.message` holds
      `⚠️ DB connection attempt ${String(attempt + 1)} failed: ${(err as { message?: unknown }).message}. ` +
        `Retrying in ${String(delayMs)}ms…`,
    );

    return new Promise<string>((resolve, reject) => {
      setTimeout(() => {
        waitForDbReady(sequelize, {
          maxAttempts,
          delayMs,
          attempt: attempt + 1,
        })
          .then(resolve)
          .catch(reject);
      }, delayMs);
    });
  }
}

export { waitForDbReady };

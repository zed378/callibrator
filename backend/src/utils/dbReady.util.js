const { Sequelize } = require("sequelize");
const { logger } = require("../middlewares/activityLog.middleware");

/**
 * Recursively checks whether the Sequelize instance can talk to the DB.
 *
 * @param {Sequelize} sequelize   – the Sequelize instance you want to test.
 * @param {Object}      opts      – optional configuration.
 * @param {number}      opts.maxAttempts   – how many times we try before giving up (default: 10).
 * @param {number}      opts.delayMs       – ms to wait between attempts (default: 2000).
 * @param {number}      opts.attempt       – internal counter – **do not set manually**.
 * @returns {Promise<string>}  resolves with a ready‑message or rejects with an error.
 */
async function waitForDbReady(
  sequelize,
  { maxAttempts = 10, delayMs = 2000, attempt = 0 } = {},
) {
  if (attempt >= maxAttempts) {
    const err = new Error(
      `Database not ready after ${maxAttempts} attempts (last delay ${delayMs}ms)`,
    );
    logger.error(`❌ ${err.message}`);
    return Promise.reject(err);
  }

  try {
    await sequelize.authenticate();

    await sequelize.query("SELECT 1");

    const msg = `✅ Database connection established (attempt ${attempt + 1})`;
    logger.info(msg);
    return Promise.resolve(msg);
  } catch (err) {
    logger.warn(
      `⚠️ DB connection attempt ${attempt + 1} failed: ${err.message}. ` +
        `Retrying in ${delayMs}ms…`,
    );

    return new Promise((resolve, reject) => {
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

module.exports = { waitForDbReady };

/**
 * P24-04 (ADR-133 Am. 4 and Am. 6) — the operator's way to provision, read and revoke a tenant's
 * upstream IMPORT KEY. The transform fails `IMPORT_KEY_MISSING` without a usable key (an imported
 * calibration whose upstream user is NULL or deleted is recorded by it), and the cutover revokes it
 * (P30, FT-101). There is no HTTP route for any of this, by design: the key's secret is discarded at
 * creation, so it can never be presented over HTTP.
 *
 *   in the container (the image has no Node):
 *     docker exec <backend-container> ./backend import-key provision \
 *       --tenant <provider tenant id> --user <operator e-mail or username> \
 *       --sign-off YYYY-MM-DD --data-class synthetic|real
 *     docker exec <backend-container> ./backend import-key status --tenant <id>
 *     docker exec <backend-container> ./backend import-key revoke --tenant <id> --user <operator>
 *   from a source checkout (against backend/.env's database):
 *     npm run import-key -- provision --tenant <id> --user <operator> --sign-off YYYY-MM-DD --data-class synthetic
 *
 * `provision` creates the key (name `upstream-import`, scope `calibration:write` only, expiring at the
 * sign-off + 90 days) or says the tenant already has a usable one and writes nothing. `--data-class real`
 * is refused while UPSTREAM_REAL_DATA_ALLOWED is off (the DPIA gate). `revoke` revokes every live
 * import key of the tenant and then runs the runbook check. Both name `--user`, an ACTIVE user of that
 * tenant: the key's `created_by` and the audit rows are theirs. `status` changes nothing.
 *
 * It runs in the tenant's context (`runForTenant`), so every query is confined to the tenant named.
 * Authority: the database credentials, or `docker exec` on the backend — as for the other CLIs here.
 * It prints the key's PREFIX at most, never anything secret (stdout reaches `docker logs`).
 *
 * Exit codes: 0 done · 1 refused (the message says why) · 2 usage.
 */
// FIRST, as every CLI here does: backend/.env is read before any module that reads the environment
// at load (`../config` requires the JWT secrets as it loads).
import "../utils/env.util";
import { db } from "../config";
import models from "../models";
import { toTenantId, type TenantId } from "../types/ids";
import { runForTenant } from "../utils/jobContext.util";
import {
  importKeyRevoked,
  importKeyStatus,
  importOperator,
  provisionImportKey,
  revokeImportKeys,
  type ImportKeyView,
} from "../services/upstreamImport/importKey";

const USAGE =
  "usage: import-key provision --tenant <id> --user <email|username> --sign-off YYYY-MM-DD --data-class synthetic|real\n" +
  "       import-key status --tenant <id>\n" +
  "       import-key revoke --tenant <id> --user <email|username>";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value after `--name`, or "". */
const readFlag = (argv: readonly string[], name: string): string => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < argv.length ? (argv[at + 1] ?? "") : "";
};

/** One line to stdout or stderr (not `console`: A-42; not the logger: its files are a host-visible volume). */
const report = (stream: NodeJS.WriteStream, line: string): void => {
  stream.write(`${line}\n`);
};

/** A refusal that is a usage error: exit 2, with the usage. */
class UsageError extends Error {}

const describe = (key: ImportKeyView): string =>
  `${key.keyPrefix}… (${key.scopes.join(", ")}), expires ${key.expiresAt ? key.expiresAt.toISOString().slice(0, 10) : "never"}`;

/** The tenant named by `--tenant`, which must exist. */
const tenantOf = async (args: readonly string[]): Promise<{ id: TenantId; name: string }> => {
  const raw = readFlag(args, "tenant");
  if (!UUID.test(raw)) {
    throw new UsageError("--tenant must be the provider tenant's id (a UUID).");
  }
  const tenant = await models.Tenant.findOne({ where: { id: raw }, attributes: ["id", "name"] });
  if (!tenant) {
    throw new Error("No tenant has that id.");
  }
  return { id: toTenantId(tenant.id), name: tenant.name };
};

/** The operator named by `--user`, an active user of the tenant. */
const operatorOf = (args: readonly string[], tenant: TenantId): Promise<{ userId: string }> => {
  const identifier = readFlag(args, "user");
  if (!identifier) {
    throw new UsageError("--user is required: the operator's e-mail or username.");
  }
  return importOperator(tenant, identifier);
};

const provision = async (args: readonly string[]): Promise<void> => {
  const signOffDate = readFlag(args, "sign-off");
  const dataClass = readFlag(args, "data-class");
  if (!signOffDate) {
    throw new UsageError("--sign-off is required: the planned sign-off day, YYYY-MM-DD.");
  }
  if (dataClass !== "synthetic" && dataClass !== "real") {
    throw new UsageError("--data-class is required and must be `synthetic` or `real`: declare what the run loads.");
  }
  const tenant = await tenantOf(args);
  await runForTenant(tenant.id, async () => {
    const operator = await operatorOf(args, tenant.id);
    const { key, created } = await provisionImportKey(tenant.id, { signOffDate, dataClass }, operator);
    report(
      process.stdout,
      created
        ? `Import key created for ${tenant.name}: ${describe(key)}. Recorded by ${operator.userId}.`
        : `${tenant.name} already has a usable import key: ${describe(key)}. Nothing was written.`,
    );
  });
};

const status = async (args: readonly string[]): Promise<void> => {
  const tenant = await tenantOf(args);
  await runForTenant(tenant.id, async () => {
    const { keys, usable } = await importKeyStatus(tenant.id);
    if (keys.length === 0) {
      report(process.stdout, `${tenant.name} has no live import key.`);
      return;
    }
    for (const key of keys) {
      report(process.stdout, `${tenant.name}: ${describe(key)}`);
    }
    report(process.stdout, usable ? "A usable import key exists." : "None of these can record any more (expired or not the import scope).");
  });
};

const revoke = async (args: readonly string[]): Promise<void> => {
  const tenant = await tenantOf(args);
  await runForTenant(tenant.id, async () => {
    const operator = await operatorOf(args, tenant.id);
    const revoked = await revokeImportKeys(tenant.id, operator);
    const clear = await importKeyRevoked(tenant.id);
    report(
      process.stdout,
      `${String(revoked.length)} import key(s) of ${tenant.name} revoked by ${operator.userId}. ` +
        `Runbook check (no live import key): ${clear ? "ok" : "FAILED — one is still live"}.`,
    );
    if (!clear) {
      throw new Error("A live import key remains after the revocation.");
    }
  });
};

const SUBCOMMANDS: Readonly<Record<string, (args: readonly string[]) => Promise<void>>> = Object.freeze({
  provision,
  status,
  revoke,
});

/**
 * @param args - the arguments after the command name: the subcommand, then its flags
 * @returns the process exit code
 */
const main = async (args: readonly string[]): Promise<number> => {
  const name = args[0] ?? "";
  const run = Object.prototype.hasOwnProperty.call(SUBCOMMANDS, name) ? SUBCOMMANDS[name] : undefined;
  if (!run) {
    report(process.stderr, USAGE);
    return 2;
  }
  try {
    await run(args.slice(1));
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      report(process.stderr, `${err.message}\n${USAGE}`);
      return 2;
    }
    report(process.stderr, `Refused: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await db.close().catch(() => undefined);
  }
};

export { main, readFlag };

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

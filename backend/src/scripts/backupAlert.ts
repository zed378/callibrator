/**
 * U-05 (ADR-116) — raise the infrastructure backup's outcome as an alert.
 *
 *   in the backup verifier (deploy/backup/backup-verify.sh runs it after every run):
 *     /opt/callibrator/backend backup-alert /backups/last-restore-verify.json
 *
 * A failed dump or restore verification goes through alert.service — the log
 * line of record plus ALERT_WEBHOOK_URL / ALERT_EMAIL_TO when set — exactly as
 * every P7-02 alert does. A passing run raises nothing. Exit 0 when the outcome
 * was read, 1 when it could not be (that is alerted too). The logic is
 * services/backupVerify.service#reportOutcome; this is its entry point.
 */
import backupVerifyService from "../services/backupVerify.service";

/**
 * @param args - the arguments after the command name: the outcome file
 * @returns the process exit code
 */
const main = async (args: readonly string[]): Promise<number> => {
  const file = args[0] ?? "";
  if (!file) {
    process.stderr.write("usage: backup-alert <outcome.json>\n");
    return 2;
  }
  const code = await backupVerifyService.reportOutcome(file);
  process.stdout.write(`backup-alert: ${file} ${code === 0 ? "reported" : "UNREADABLE (alerted)"}\n`);
  return code;
};

export { main };

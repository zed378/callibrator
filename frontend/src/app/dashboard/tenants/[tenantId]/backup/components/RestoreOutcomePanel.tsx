import React from "react";
import type {
  NotRestoredEntry,
  NotRestoredReason,
  RestoreOutcome,
} from "@/api/services/tenantBackup.service";
import { Alert, Badge } from "@/components/ui";

/**
 * What the last restore did, account by account (A-156).
 *
 * A restore never creates an account (ADR-051 Q-09). An account in the backup
 * that no longer exists in the tenant is listed here with the backend's
 * reason, so the operator can act on it — re-invite an `absent` account, and
 * leave an `erased` one alone.
 */

const REASON_LABEL: Record<NotRestoredReason, string> = {
  absent: "Not in this tenant",
  erased: "Erased (GDPR)",
};

const REASON_ACTION: Record<NotRestoredReason, string> = {
  absent:
    "Re-invite through Users if this person still needs access. The restore does not re-create accounts.",
  erased:
    "This person's data was erased on request. Do not re-invite them.",
};

const reasonOf = (entry: NotRestoredEntry): NotRestoredReason =>
  entry.reason === "erased" ? "erased" : "absent";

interface RestoreOutcomePanelProps {
  outcome: RestoreOutcome;
  onClose?: () => void;
}

export const RestoreOutcomePanel: React.FC<RestoreOutcomePanelProps> = ({
  outcome,
  onClose,
}) => {
  const notRestored = outcome.notRestored ?? [];
  const summary = [
    `${outcome.recordsProcessed} account(s) in the backup`,
    `${outcome.updated} updated`,
    `${outcome.unchanged} left unchanged`,
    `${outcome.skippedDeleted} deleted and not revived`,
    `${outcome.retained} kept that are not in the backup`,
  ].join(" · ");

  if (notRestored.length === 0) {
    return (
      <Alert variant="info" title="Restore result" onClose={onClose}>
        <p>{summary}</p>
        <p className="mt-1">Every account in the backup was matched.</p>
      </Alert>
    );
  }

  return (
    <Alert
      variant="warning"
      title={`${notRestored.length} account(s) were not restored`}
      onClose={onClose}
    >
      <p>{summary}</p>
      <p className="mt-2">
        A restore never re-creates an account. These accounts are in the backup
        but not in this tenant, so they were skipped:
      </p>
      <ul className="mt-2 space-y-2" aria-label="Accounts not restored">
        {notRestored.map((entry) => {
          const reason = reasonOf(entry);
          return (
            <li
              key={`${entry.entry}-${entry.username}`}
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
            >
              <span className="font-medium text-foreground">
                {entry.username}
              </span>
              <Badge variant={reason === "erased" ? "danger" : "warning"}>
                {REASON_LABEL[reason]}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {REASON_ACTION[reason]}
              </span>
            </li>
          );
        })}
      </ul>
    </Alert>
  );
};

export default RestoreOutcomePanel;

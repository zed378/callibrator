import React from "react";
import { backupLabel, type TenantBackup, type TenantBackupStatus } from "@/api/services/tenantBackup.service";
import { Card, CardContent, Badge, Button } from "@/components/ui";
import {
  FileArchive,
  Loader2,
  AlertTriangle,
  Download,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface BackupListProps {
  backups: TenantBackup[];
  actionLoading: string | null;
  handleDownloadBackup: (id: string) => void;
  /** Asks for confirmation first (the page's ConfirmDialog); never restores on one click. */
  handleRestoreBackup: (id: string) => void;
  /** Asks for confirmation first. */
  handleDeleteBackup: (id: string) => void;
}

export const BackupList: React.FC<BackupListProps> = ({
  backups,
  actionLoading,
  handleDownloadBackup,
  handleRestoreBackup,
  handleDeleteBackup,
}) => {
  // A-362: keyed by the API's lower-case status (TenantBackup.STATUS). It was
  // keyed COMPLETED / FAILED / ..., which no row carries, so every badge fell
  // to the fallback.
  const getStatusBadge = (status: TenantBackupStatus) => {
return <StatusBadge domain="backup" state={status} size="sm" />;
  };

  // The create stores the type as sent ("FULL"); the scheduled job stores
  // the model's "full". Matched in either case; a NULL type reads as FULL.
  const getBackupTypeBadge = (type: string | null) => {
    const colors: Record<string, string> = {
      FULL: "bg-info/10 text-info",
      PARTIAL:
        "bg-warning/10 text-warning",
      USER_ONLY:
        "bg-success/10 text-success",
    };
    const key = (type ?? "FULL").toUpperCase();
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${colors[key] ?? colors.FULL}`}
      >
        {key}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {backups.map((backup) => (
        <Card key={backup.id}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4 flex-1">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileArchive className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-foreground text-lg">
                      {backupLabel(backup)}
                    </h3>
                    {getStatusBadge(backup.status)}
                    {getBackupTypeBadge(backup.backupType)}
                    {backup.tag && (
                      <Badge variant="default" size="sm">
                        {backup.tag}
                      </Badge>
                    )}
                  </div>
                  {backup.description && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {backup.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    <span>
                      Created: {new Date(backup.createdAt).toLocaleString()}
                    </span>
                    {backup.restoredAt && (
                      <span>
                        Restored: {new Date(backup.restoredAt).toLocaleString()}
                      </span>
                    )}
                    {backup.fileSize && <span>Size: {backup.fileSize}</span>}
                  </div>
                  {backup.errorMessage && (
                    <div className="mt-2 text-sm text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{backup.errorMessage}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* A-362: only a completed backup has an archive to download or restore. */}
                {backup.status === "completed" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Download className="h-4 w-4" />}
                      onClick={() => handleDownloadBackup(backup.id)}
                      disabled={actionLoading !== null}
                    >
                      Download
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<RotateCcw className="h-4 w-4" />}
                      onClick={() => handleRestoreBackup(backup.id)}
                      disabled={actionLoading !== null}
                      aria-label={`Restore backup ${backupLabel(backup)}`}
                    >
                      Restore
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={
                    actionLoading === backup.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )
                  }
                  onClick={() => handleDeleteBackup(backup.id)}
                  aria-label={`Delete backup ${backupLabel(backup)}`}
                  disabled={
                    actionLoading !== null &&
                    actionLoading !== backup.id
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default BackupList;

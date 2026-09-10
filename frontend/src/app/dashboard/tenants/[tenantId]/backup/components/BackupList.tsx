import React from "react";
import { TenantBackup } from "@/api/services/tenantBackup.service";
import { Card, CardContent, Badge, Button } from "@/components/ui";
import {
  FileArchive,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
  Download,
  RotateCcw,
  Trash2,
} from "lucide-react";

interface BackupListProps {
  backups: TenantBackup[];
  actionLoading: string | null;
  handleDownloadBackup: (id: string) => void;
  handleRestoreBackup: (id: string) => void;
  handleDeleteBackup: (id: string) => void;
}

export const BackupList: React.FC<BackupListProps> = ({
  backups,
  actionLoading,
  handleDownloadBackup,
  handleRestoreBackup,
  handleDeleteBackup,
}) => {
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<
      string,
      {
        variant: "success" | "danger" | "warning" | "default";
        icon: React.ReactNode;
      }
    > = {
      COMPLETED: {
        variant: "success",
        icon: <CheckCircle className="h-3 w-3" />,
      },
      FAILED: {
        variant: "danger",
        icon: <XCircle className="h-3 w-3" />,
      },
      IN_PROGRESS: {
        variant: "warning",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
      },
      PENDING: {
        variant: "default",
        icon: <Clock className="h-3 w-3" />,
      },
      DELETING: {
        variant: "warning",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
      },
    };
    const config = statusConfig[status] || statusConfig.PENDING;
    return (
      <Badge variant={config.variant} size="sm">
        {config.icon}
        <span className="ml-1">{status}</span>
      </Badge>
    );
  };

  const getBackupTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      FULL: "bg-info/10 text-info",
      PARTIAL:
        "bg-warning/10 text-warning",
      USER_ONLY:
        "bg-success/10 text-success",
    };
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${colors[type] || colors.FULL}`}
      >
        {type}
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
                <div className="w-12 h-12 rounded-lg bg-linear-to-br from-info to-primary flex items-center justify-center flex-shrink-0">
                  <FileArchive className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-foreground text-lg">
                      {backup.name}
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
                    {backup.completedAt && (
                      <span>
                        Completed: {new Date(backup.completedAt).toLocaleString()}
                      </span>
                    )}
                    {backup.fileSize && <span>Size: {backup.fileSize}</span>}
                  </div>
                  {backup.error && (
                    <div className="mt-2 text-sm text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{backup.error}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {backup.status === "COMPLETED" && (
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

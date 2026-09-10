// src/app/dashboard/audit/components/AuditTable.tsx
import React, { useState } from "react";
import {
  Card,
  CardContent,
  Badge,
  Button,
  Pagination,
  TableSkeleton,
} from "@/components/ui";
import { ChevronDown, ChevronRight, FileSearch } from "lucide-react";
import { AuditAction, AuditLog, AuditMeta } from "@/api/services/audit.service";

interface AuditTableProps {
  logs: AuditLog[];
  isLoading: boolean;
  meta: AuditMeta;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const ACTION_BADGES: Record<
  AuditAction,
  { variant: "default" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  CREATE: { variant: "success", label: "CREATE" },
  UPDATE: { variant: "info", label: "UPDATE" },
  DELETE: { variant: "danger", label: "DELETE" },
  LOGIN: { variant: "default", label: "LOGIN" },
  APPROVE: { variant: "success", label: "APPROVE" },
  EXPORT: { variant: "warning", label: "EXPORT" },
};

const COLUMN_COUNT = 6;

function truncateId(id: string, length = 8): string {
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

export const AuditTable: React.FC<AuditTableProps> = ({
  logs,
  isLoading,
  meta,
  pageSize,
  onPageChange,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardContent>
          <TableSkeleton cols={COLUMN_COUNT} rows={5} />
        </CardContent>
      </Card>
    );
  }

  if (logs.length === 0) {
    return (
      <Card className="border-border">
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <FileSearch className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No audit logs found</p>
            <p className="text-sm">
              Try adjusting your filters or date range.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        <div className="overflow-x-auto w-full rounded-2xl bg-card shadow-xs">
          <table className="w-full border-collapse">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="px-4 py-4 w-10" aria-label="Expand" />
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Timestamp
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  User
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Action
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Resource
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => {
                const badge = ACTION_BADGES[log.action] ?? {
                  variant: "default" as const,
                  label: log.action,
                };
                const hasChanges =
                  !!log.changes &&
                  (log.changes.before !== undefined ||
                    log.changes.after !== undefined);
                const isExpanded = expandedId === log.id;

                return (
                  <React.Fragment key={log.id}>
                    <tr className="border-b border-border transition-colors duration-150 hover:bg-muted/50">
                      <td className="px-4 py-4">
                        {hasChanges && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpanded(log.id)}
                            className="text-muted-foreground hover:text-foreground"
                            title={isExpanded ? "Hide changes" : "Show changes"}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {log.user ? (
                          <div>
                            <div className="font-semibold text-foreground">
                              {log.user.username}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {log.user.email}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">
                            System
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <Badge variant={badge.variant} size="sm">
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="text-foreground">{log.resourceType}</div>
                        {log.resourceId && (
                          <div
                            className="text-xs font-mono text-muted-foreground"
                            title={log.resourceId}
                          >
                            {truncateId(log.resourceId)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-muted-foreground">
                        {log.ipAddress || "-"}
                      </td>
                    </tr>
                    {isExpanded && hasChanges && (
                      <tr className="bg-muted/30">
                        <td colSpan={COLUMN_COUNT} className="px-6 py-4">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                            Changes
                          </p>
                          <pre className="text-xs overflow-auto max-h-96 p-4 rounded-xl bg-muted text-foreground">
                            {JSON.stringify(log.changes, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={meta.page}
          totalPages={meta.totalPages}
          totalItems={meta.total}
          pageSize={pageSize}
          onPageChange={onPageChange}
        />
      </CardContent>
    </Card>
  );
};

export default AuditTable;

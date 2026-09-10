// src/app/dashboard/attachments/components/AttachmentsTable.tsx
import React from "react";
import { Attachment } from "@/api/services/attachment.service";
import {
  Card,
  CardContent,
  TableSkeleton,
  Table,
  Badge,
  Button,
  Pagination,
} from "@/components/ui";
import { FileText, Download, Trash2 } from "lucide-react";
import { PaginatedResponse } from "@/types";

interface AttachmentsTableProps {
  attachments: PaginatedResponse<Attachment> | null;
  isLoading: boolean;
  pageSize: number;
  downloadingId: string | null;
  setCurrentPage: (page: number) => void;
  onDownload: (attachment: Attachment) => void;
  onDelete: (attachment: Attachment) => void;
}

const asNode = (value: unknown) => value as React.ReactNode;

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
};

export const AttachmentsTable: React.FC<AttachmentsTableProps> = ({
  attachments,
  isLoading,
  pageSize,
  downloadingId,
  setCurrentPage,
  onDownload,
  onDelete,
}) => {
  const columns = [
    { key: "name", header: "File", render: asNode },
    { key: "type", header: "Linked To", render: asNode },
    { key: "size", header: "Size", render: asNode },
    { key: "uploaded", header: "Uploaded", render: asNode },
    { key: "actions", header: "Actions", render: asNode },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isLoading ? (
          <TableSkeleton cols={columns.length} rows={5} />
        ) : !attachments || attachments.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No files yet</p>
            <p className="text-sm">
              Upload documents, images, or evidence to the file store.
            </p>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              data={attachments.data.map((att: Attachment) => ({
                id: att.id,
                name: (
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span
                      className="font-medium text-foreground truncate max-w-[280px]"
                      title={att.originalName}
                    >
                      {att.originalName}
                    </span>
                  </div>
                ),
                type: (
                  <div className="flex flex-col gap-1">
                    <Badge variant="secondary" size="sm">
                      {att.resourceType}
                    </Badge>
                    {att.resourceId && (
                      <code className="font-mono text-[10px] text-muted-foreground truncate max-w-[160px]">
                        {att.resourceId}
                      </code>
                    )}
                  </div>
                ),
                size: (
                  <span className="text-sm text-muted-foreground">
                    {formatBytes(Number(att.size) || 0)}
                  </span>
                ),
                uploaded: (
                  <span className="text-sm">
                    {new Date(att.createdAt).toLocaleString()}
                  </span>
                ),
                actions: (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      isLoading={downloadingId === att.id}
                      onClick={() => onDownload(att)}
                      className="flex items-center gap-1"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(att)}
                      className="text-destructive hover:text-destructive hover:bg-muted flex items-center gap-1"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                ),
              }))}
            />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={attachments.meta.page}
                totalPages={attachments.meta.totalPages}
                totalItems={attachments.meta.total ?? 0}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AttachmentsTable;

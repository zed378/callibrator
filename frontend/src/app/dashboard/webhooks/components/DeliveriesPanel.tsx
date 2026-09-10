// src/app/dashboard/webhooks/components/DeliveriesPanel.tsx
import React from "react";
import {
  Webhook,
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "@/api/services/webhook.service";
import {
  Card,
  CardContent,
  TableSkeleton,
  Table,
  Badge,
  Button,
  Alert,
  Pagination,
} from "@/components/ui";
import { Inbox, X } from "lucide-react";
import { PaginatedResponse } from "@/types";

interface DeliveriesPanelProps {
  webhook: Webhook;
  deliveries: PaginatedResponse<WebhookDelivery> | null;
  isLoading: boolean;
  error: string | null;
  pageSize: number;
  setPage: (page: number) => void;
  onClose: () => void;
}

const asNode = (value: unknown) => value as React.ReactNode;

const statusVariant: Record<
  WebhookDeliveryStatus,
  "success" | "warning" | "danger"
> = {
  success: "success",
  pending: "warning",
  failed: "danger",
  exhausted: "danger",
};

export const DeliveriesPanel: React.FC<DeliveriesPanelProps> = ({
  webhook,
  deliveries,
  isLoading,
  error,
  pageSize,
  setPage,
  onClose,
}) => {
  const columns = [
    { key: "event", header: "Event", render: asNode },
    { key: "status", header: "Status", render: asNode },
    { key: "attempts", header: "Attempts", render: asNode },
    { key: "responseStatus", header: "Response", render: asNode },
    { key: "time", header: "Time", render: asNode },
    { key: "lastError", header: "Last Error", render: asNode },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-foreground">
              Recent Deliveries
            </h2>
            <code
              className="font-mono text-xs text-muted-foreground block max-w-md truncate"
              title={webhook.url}
            >
              {webhook.url}
            </code>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Close deliveries panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {error && (
          <div className="p-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {isLoading ? (
          <TableSkeleton cols={columns.length} rows={4} />
        ) : !deliveries || deliveries.data.length === 0 ? (
          !error && (
            <div className="text-center py-10 text-muted-foreground">
              <Inbox className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No deliveries yet</p>
              <p className="text-sm">
                Deliveries will appear here once events are sent to this
                webhook.
              </p>
            </div>
          )
        ) : (
          <>
            <Table
              columns={columns}
              data={deliveries.data.map((delivery: WebhookDelivery) => ({
                id: delivery.id,
                event: (
                  <code className="font-mono text-xs">{delivery.event}</code>
                ),
                status: (
                  <Badge
                    variant={statusVariant[delivery.status] || "danger"}
                    size="sm"
                  >
                    {delivery.status}
                  </Badge>
                ),
                attempts: <span className="text-sm">{delivery.attempts}</span>,
                responseStatus:
                  delivery.responseStatus != null ? (
                    <span className="text-sm">{delivery.responseStatus}</span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  ),
                time: (
                  <span className="text-sm">
                    {new Date(
                      delivery.deliveredAt || delivery.createdAt,
                    ).toLocaleString()}
                  </span>
                ),
                lastError: delivery.lastError ? (
                  <span
                    className="text-xs text-destructive block max-w-[220px] truncate"
                    title={delivery.lastError}
                  >
                    {delivery.lastError}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
              }))}
            />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={deliveries.meta.page}
                totalPages={deliveries.meta.totalPages}
                totalItems={deliveries.meta.total ?? 0}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default DeliveriesPanel;

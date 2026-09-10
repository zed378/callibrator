// src/app/dashboard/webhooks/components/WebhooksTable.tsx
import React from "react";
import { Webhook } from "@/api/services/webhook.service";
import {
  Card,
  CardContent,
  TableSkeleton,
  Table,
  Badge,
  Button,
  Pagination,
} from "@/components/ui";
import { Webhook as WebhookIcon, Edit, Trash2, Send, List } from "lucide-react";
import { PaginatedResponse } from "@/types";

interface WebhooksTableProps {
  webhooks: PaginatedResponse<Webhook> | null;
  isWebhooksLoading: boolean;
  pageSize: number;
  setCurrentPage: (page: number) => void;
  testingId: string | null;
  deliveriesWebhookId: string | null;
  handleTestClick: (webhook: Webhook) => void;
  toggleDeliveries: (webhook: Webhook) => void;
  openEditModal: (webhook: Webhook) => void;
  handleDeleteClick: (webhook: Webhook) => void;
}

const asNode = (value: unknown) => value as React.ReactNode;

const MAX_EVENT_CHIPS = 2;

export const WebhooksTable: React.FC<WebhooksTableProps> = ({
  webhooks,
  isWebhooksLoading,
  pageSize,
  setCurrentPage,
  testingId,
  deliveriesWebhookId,
  handleTestClick,
  toggleDeliveries,
  openEditModal,
  handleDeleteClick,
}) => {
  const renderEvents = (events: string[]) => {
    const visible = events.slice(0, MAX_EVENT_CHIPS);
    const remaining = events.length - visible.length;
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((event) => (
          <Badge key={event} variant="primary" size="sm">
            {event}
          </Badge>
        ))}
        {remaining > 0 && (
          <Badge variant="default" size="sm">
            +{remaining}
          </Badge>
        )}
      </div>
    );
  };

  const columns = [
    { key: "url", header: "URL", render: asNode },
    { key: "events", header: "Events", render: asNode },
    { key: "status", header: "Status", render: asNode },
    { key: "created", header: "Created", render: asNode },
    { key: "actions", header: "Actions", render: asNode },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isWebhooksLoading ? (
          <TableSkeleton cols={columns.length} rows={5} />
        ) : !webhooks || webhooks.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <WebhookIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No webhooks yet</p>
            <p className="text-sm">
              Add a webhook to receive event notifications on your endpoint.
            </p>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              data={webhooks.data.map((webhook: Webhook) => ({
                id: webhook.id,
                url: (
                  <code
                    className="font-mono text-xs text-foreground block max-w-[280px] truncate"
                    title={webhook.url}
                  >
                    {webhook.url}
                  </code>
                ),
                events: renderEvents(webhook.events || []),
                status: webhook.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="default">Disabled</Badge>
                ),
                created: (
                  <span className="text-sm">
                    {new Date(webhook.createdAt).toLocaleDateString()}
                  </span>
                ),
                actions: (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTestClick(webhook)}
                      disabled={testingId === webhook.id}
                      className="text-primary hover:text-primary hover:bg-muted flex items-center gap-1"
                      title="Send test event"
                    >
                      <Send className="h-4 w-4" />
                      {testingId === webhook.id ? "Testing..." : "Test"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleDeliveries(webhook)}
                      className={`hover:bg-muted flex items-center gap-1 ${
                        deliveriesWebhookId === webhook.id
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="View deliveries"
                    >
                      <List className="h-4 w-4" />
                      Deliveries
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(webhook)}
                      className="text-primary hover:text-primary hover:bg-muted"
                      title="Edit webhook"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteClick(webhook)}
                      className="text-destructive hover:text-destructive hover:bg-muted"
                      title="Delete webhook"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              }))}
            />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={webhooks.meta.page}
                totalPages={webhooks.meta.totalPages}
                totalItems={webhooks.meta.total ?? 0}
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

export default WebhooksTable;

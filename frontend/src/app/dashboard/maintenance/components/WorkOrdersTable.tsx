// src/app/dashboard/maintenance/components/WorkOrdersTable.tsx
import React from "react";
import {
  WorkOrder,
  WorkOrderAssignee,
} from "@/api/services/maintenance.service";
import {
  Card,
  CardContent,
  TableSkeleton,
  Table,
  Badge,
  Button,
  Pagination,
} from "@/components/ui";
import { Wrench, Edit, Trash2 } from "lucide-react";
import { PaginatedResponse } from "@/types";

interface WorkOrdersTableProps {
  workOrders: PaginatedResponse<WorkOrder> | null;
  isWorkOrdersLoading: boolean;
  pageSize: number;
  setCurrentPage: (page: number) => void;
  hasWriteAccess: boolean;
  openEditModal: (workOrder: WorkOrder) => void;
  handleDeleteClick: (id: string) => void;
}

const asNode = (value: unknown) => value as React.ReactNode;

const getAssigneeName = (assignee?: WorkOrderAssignee | null): string => {
  if (!assignee) return "";
  const fullName = [assignee.firstName, assignee.lastName]
    .filter(Boolean)
    .join(" ");
  return fullName || assignee.username || assignee.email || "";
};

export const WorkOrdersTable: React.FC<WorkOrdersTableProps> = ({
  workOrders,
  isWorkOrdersLoading,
  pageSize,
  setCurrentPage,
  hasWriteAccess,
  openEditModal,
  handleDeleteClick,
}) => {
  const getPriorityBadge = (priority: WorkOrder["priority"]) => {
    const maps: Record<
      WorkOrder["priority"],
      { variant: "danger" | "warning" | "default"; label: string }
    > = {
      Critical: { variant: "danger", label: "Critical" },
      High: { variant: "danger", label: "High" },
      Medium: { variant: "warning", label: "Medium" },
      Low: { variant: "default", label: "Low" },
    };
    const current = maps[priority] || {
      variant: "default" as const,
      label: priority,
    };
    return <Badge variant={current.variant}>{current.label}</Badge>;
  };

  const getStatusBadge = (status: WorkOrder["status"]) => {
    const maps: Record<
      WorkOrder["status"],
      { variant: "info" | "warning" | "success" | "default"; label: string }
    > = {
      Open: { variant: "info", label: "Open" },
      InProgress: { variant: "warning", label: "In Progress" },
      Completed: { variant: "success", label: "Completed" },
      Cancelled: { variant: "default", label: "Cancelled" },
    };
    const current = maps[status] || {
      variant: "default" as const,
      label: status,
    };
    return <Badge variant={current.variant}>{current.label}</Badge>;
  };

  // The shared Table uses `table-fixed` + `whitespace-nowrap`, so the title
  // column needs an explicit width and its content must truncate — otherwise
  // long titles overflow into the Type column.
  const columns = [
    { key: "title", header: "Title", render: asNode, className: "w-[28%]" },
    { key: "type", header: "Type", render: asNode },
    { key: "priority", header: "Priority", render: asNode },
    { key: "status", header: "Status", render: asNode },
    { key: "vendor", header: "Vendor", render: asNode },
    { key: "assignee", header: "Assignee", render: asNode },
    { key: "actions", header: "Actions", render: asNode, className: "w-28" },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isWorkOrdersLoading ? (
          <TableSkeleton cols={columns.length} rows={5} />
        ) : !workOrders || workOrders.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Wrench className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No work orders found</p>
            <p className="text-sm">
              Try adjusting your filters or search terms.
            </p>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              data={workOrders.data.map((order: WorkOrder) => ({
                id: order.id,
                title: (
                  <div className="min-w-0 max-w-full">
                    <div
                      className="font-semibold text-foreground truncate"
                      title={order.title}
                    >
                      {order.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {order.device?.name || "Unknown device"}
                      {order.device?.serialNumber
                        ? ` (${order.device.serialNumber})`
                        : ""}
                    </div>
                  </div>
                ),
                type: order.type,
                priority: getPriorityBadge(order.priority),
                status: getStatusBadge(order.status),
                vendor: order.vendor?.name || (
                  <span className="text-muted-foreground">-</span>
                ),
                assignee: getAssigneeName(order.assignee) || (
                  <span className="text-muted-foreground">-</span>
                ),
                actions: (
                  <div className="flex items-center gap-2">
                    {hasWriteAccess && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(order)}
                          className="text-primary hover:text-primary hover:bg-muted"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(order.id)}
                          className="text-destructive hover:text-destructive hover:bg-muted"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ),
              }))}
            />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={workOrders.meta.page}
                totalPages={workOrders.meta.totalPages}
                totalItems={workOrders.meta.total ?? 0}
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

export default WorkOrdersTable;

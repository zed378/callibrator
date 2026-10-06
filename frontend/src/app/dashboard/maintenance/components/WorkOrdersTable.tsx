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
import { StatusBadge } from "@/components/ui/StatusBadge";

interface WorkOrdersTableProps {
  workOrders: PaginatedResponse<WorkOrder> | null;
  isWorkOrdersLoading: boolean;
  pageSize: number;
  setCurrentPage: (page: number) => void;
  hasWriteAccess: boolean;
  openEditModal: (workOrder: WorkOrder) => void;
  handleDeleteClick: (id: string) => void;
  /**
   * The list request failed and nothing was ever read. The page's error alert
   * is then the state — "No work orders found" would claim an empty backlog
   * (docs/FRONTEND/10-TESTING.md § three-state assertion).
   */
  loadFailed?: boolean;
}

const asNode = (value: unknown) => value as React.ReactNode;

/** Q-55: a stored timestamp as its calendar day (YYYY-MM-DD, the form's own format). */
const formatDay = (value: string): string => value.slice(0, 10);
/** Q-55: whether a NUMERIC(14,2) cost is set (pg answers a decimal string). */
const hasCost = (value?: string | number | null): value is string | number => value !== null && value !== undefined && value !== "";
/** Q-55: a cost with two decimals and digit grouping. */
const formatCost = (value: string | number): string =>
  Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  loadFailed = false,
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
return <StatusBadge domain="workOrder" state={status} />;
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
    { key: "schedule", header: "Schedule", render: asNode },
    { key: "cost", header: "Cost", render: asNode },
    { key: "actions", header: "Actions", render: asNode, className: "w-28" },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isWorkOrdersLoading ? (
          <TableSkeleton cols={columns.length} rows={5} />
        ) : !workOrders || workOrders.data.length === 0 ? (
          loadFailed ? null : (
            <div className="text-center py-12 text-muted-foreground">
              <Wrench className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-lg font-medium">No work orders found</p>
              <p className="text-sm">
                Try adjusting your filters or search terms.
              </p>
            </div>
          )
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
                // Q-55: the schedule (and completion), and the estimate / actual cost.
                schedule: order.scheduledDate || order.completedDate ? (
                  <div className="text-xs">
                    {order.scheduledDate && <div>Planned {formatDay(order.scheduledDate)}</div>}
                    {order.completedDate && <div className="text-muted-foreground">Done {formatDay(order.completedDate)}</div>}
                  </div>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
                cost: hasCost(order.estimatedCost) || hasCost(order.actualCost) ? (
                  <div className="text-xs">
                    {hasCost(order.estimatedCost) && <div>Est. {formatCost(order.estimatedCost)}</div>}
                    {hasCost(order.actualCost) && <div className="text-muted-foreground">Actual {formatCost(order.actualCost)}</div>}
                  </div>
                ) : (
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
                          aria-label={`Edit ${order.title}`}
                          className="text-primary hover:text-primary hover:bg-muted"
                        >
                          <Edit className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(order.id)}
                          aria-label={`Delete ${order.title}`}
                          className="text-destructive hover:text-destructive hover:bg-muted"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
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

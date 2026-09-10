import React from "react";
import { StockTransfer } from "@/types";
import { Table, Badge, Button } from "@/components/ui";
import { Clock, XCircle, CheckCircle } from "lucide-react";

interface TransfersTableProps {
  data: StockTransfer[];
  hasWriteAccess: boolean;
  handleUpdateTransferStatus: (id: string, status: "pending" | "in_transit" | "completed" | "cancelled") => void;
}

export const TransfersTable: React.FC<TransfersTableProps> = ({
  data,
  hasWriteAccess,
  handleUpdateTransferStatus,
}) => {
  const getTransferStatusBadge = (status: "pending" | "in_transit" | "completed" | "cancelled") => {
    const variants = {
      pending: "warning" as const,
      in_transit: "primary" as const,
      completed: "success" as const,
      cancelled: "danger" as const,
    };
    return <Badge variant={variants[status]}>{status.toUpperCase().replace("_", " ")}</Badge>;
  };

  const columns = [
    {
      key: "itemName",
      header: "Transfer Details",
      render: (_: unknown, row: Record<string, unknown>) => {
        const t = row as unknown as StockTransfer;
        return (
          <div>
            <div className="font-semibold text-foreground">{t.itemName}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Qty: {t.quantity} units</div>
          </div>
        );
      },
    },
    {
      key: "route",
      header: "Depot Route",
      render: (_: unknown, row: Record<string, unknown>) => {
        const t = row as unknown as StockTransfer;
        return (
          <div className="text-xs">
            <span className="font-semibold text-destructive">{t.fromWarehouse?.name}</span>
            <span className="mx-2 text-muted-foreground">➔</span>
            <span className="font-semibold text-success">{t.toWarehouse?.name}</span>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (val: unknown) => getTransferStatusBadge(val as "pending" | "in_transit" | "completed" | "cancelled"),
    },
    {
      key: "staff",
      header: "Staff Log",
      render: (_: unknown, row: Record<string, unknown>) => {
        const t = row as unknown as StockTransfer;
        return (
          <div className="text-xs text-muted-foreground">
            <div>Req: {t.requester ? `${t.requester.firstName} ${t.requester.lastName}` : "-"}</div>
            {t.approver && <div>App: {t.approver.firstName} {t.approver.lastName}</div>}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (_: unknown, row: Record<string, unknown>) => {
        const t = row as unknown as StockTransfer;
        if (!hasWriteAccess) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            {t.status === "pending" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => handleUpdateTransferStatus(t.id, "in_transit")} leftIcon={<Clock className="h-4.5 w-4.5 text-info" />}>
                  Ship
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleUpdateTransferStatus(t.id, "cancelled")} leftIcon={<XCircle className="h-4.5 w-4.5 text-destructive" />} className="text-destructive">
                  Cancel
                </Button>
              </>
            )}
            {t.status === "in_transit" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => handleUpdateTransferStatus(t.id, "completed")} leftIcon={<CheckCircle className="h-4.5 w-4.5 text-success" />}>
                  Complete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleUpdateTransferStatus(t.id, "cancelled")} leftIcon={<XCircle className="h-4.5 w-4.5 text-destructive" />} className="text-destructive">
                  Cancel
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  return <Table columns={columns} data={data as unknown as Record<string, unknown>[]} emptyMessage="No transfers found." />;
};

export default TransfersTable;

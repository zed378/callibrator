import React from "react";
import { StockOpname } from "@/types";
import { Table, Badge, Button } from "@/components/ui";
import { Play, CheckCircle } from "lucide-react";

interface OpnamesTableProps {
  data: StockOpname[];
  hasWriteAccess: boolean;
  handleUpdateOpnameStatus: (id: string, status: "draft" | "in_progress" | "completed") => void;
}

export const OpnamesTable: React.FC<OpnamesTableProps> = ({
  data,
  hasWriteAccess,
  handleUpdateOpnameStatus,
}) => {
  const getOpnameStatusBadge = (status: "draft" | "in_progress" | "completed") => {
    const variants = {
      draft: "default" as const,
      in_progress: "warning" as const,
      completed: "success" as const,
    };
    return <Badge variant={variants[status]}>{status.toUpperCase()}</Badge>;
  };

  const columns = [
    {
      key: "warehouse",
      header: "Depot",
      render: (_: unknown, row: Record<string, unknown>) => {
        const o = row as unknown as StockOpname;
        return <div className="font-semibold text-foreground">{o.warehouse?.name}</div>;
      },
    },
    {
      key: "scheduledAt",
      header: "Schedule Date",
      render: (val: unknown) => <span className="text-xs text-muted-foreground">{val ? new Date(val as string).toLocaleString() : "-"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (val: unknown) => getOpnameStatusBadge(val as "draft" | "in_progress" | "completed"),
    },
    {
      key: "staff",
      header: "Performer",
      render: (_: unknown, row: Record<string, unknown>) => {
        const o = row as unknown as StockOpname;
        return <span className="text-xs text-muted-foreground">{o.performer ? `${o.performer.firstName} ${o.performer.lastName}` : "-"}</span>;
      },
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (_: unknown, row: Record<string, unknown>) => {
        const o = row as unknown as StockOpname;
        if (!hasWriteAccess) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            {o.status === "draft" && (
              <Button variant="ghost" size="sm" onClick={() => handleUpdateOpnameStatus(o.id, "in_progress")} leftIcon={<Play className="h-4 w-4 text-warning" />}>
                Start
              </Button>
            )}
            {o.status === "in_progress" && (
              <Button variant="ghost" size="sm" onClick={() => handleUpdateOpnameStatus(o.id, "completed")} leftIcon={<CheckCircle className="h-4 w-4 text-success" />}>
                Complete
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return <Table columns={columns} data={data as unknown as Record<string, unknown>[]} emptyMessage="No physical counts found." />;
};

export default OpnamesTable;

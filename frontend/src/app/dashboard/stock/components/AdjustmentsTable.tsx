import React from "react";
import { StockAdjustment } from "@/types";
import { Table, Badge } from "@/components/ui";

interface AdjustmentsTableProps {
  data: StockAdjustment[];
}

export const AdjustmentsTable: React.FC<AdjustmentsTableProps> = ({ data }) => {
  const columns = [
    {
      key: "itemName",
      header: "Adjustment Log",
      render: (_: unknown, row: Record<string, unknown>) => {
        const a = row as unknown as StockAdjustment;
        return (
          <div>
            <div className="font-semibold text-foreground">{a.warehouse?.name || "Inventory Item"}</div>
            {a.reason && <div className="text-xs text-muted-foreground mt-0.5">{a.reason}</div>}
          </div>
        );
      },
    },
    {
      key: "type",
      header: "Type",
      render: (val: unknown) => {
        const t = val as string;
        const variants = { addition: "success" as const, subtraction: "warning" as const, write_off: "danger" as const };
        return <Badge variant={variants[t as keyof typeof variants]}>{t.toUpperCase()}</Badge>;
      },
    },
    {
      key: "quantity",
      header: "Adjustment Quantity",
      render: (val: unknown) => <span className="font-bold text-foreground">{String(val)} units</span>,
    },
    {
      key: "staff",
      header: "Performed By",
      render: (_: unknown, row: Record<string, unknown>) => {
        const a = row as unknown as StockAdjustment;
        return <span className="text-xs text-muted-foreground">{a.adjuster ? `${a.adjuster.firstName} ${a.adjuster.lastName}` : "-"}</span>;
      },
    },
    {
      key: "createdAt",
      header: "Date Logged",
      render: (val: unknown) => <span className="text-xs text-muted-foreground">{val ? new Date(val as string).toLocaleString() : "-"}</span>,
    },
  ];

  return <Table columns={columns} data={data as unknown as Record<string, unknown>[]} emptyMessage="No adjustments found." />;
};

export default AdjustmentsTable;

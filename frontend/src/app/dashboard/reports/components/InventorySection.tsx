// src/app/dashboard/reports/components/InventorySection.tsx
import React from "react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { Table } from "@/components/ui/Table";
import { Download, Package } from "lucide-react";
import { InventoryReport } from "@/api/services/report.service";
import { MetricCard } from "./ReportCards";

interface InventorySectionProps {
  inventory: InventoryReport | null;
  onExport: () => void;
  isExporting: boolean;
}

export const InventorySection: React.FC<InventorySectionProps> = ({
  inventory,
  onExport,
  isExporting,
}) => {
  const rows = inventory?.rows || [];
  const summary = inventory?.summary;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          leftIcon={<Download className="h-4 w-4" />}
          onClick={onExport}
          isLoading={isExporting}
        >
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard title="Total Items" value={summary?.totalItems ?? 0} />
        <MetricCard
          title="Total Quantity"
          value={summary?.totalQuantity ?? 0}
        />
        <MetricCard
          title="Low Stock Items"
          value={summary?.lowStockCount ?? 0}
          valueClassName={
            (summary?.lowStockCount ?? 0) > 0 ? "text-warning" : "text-success"
          }
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-16 text-center">
            <Package className="mx-auto h-16 w-16 text-muted-foreground" />
            <h3 className="text-xl font-semibold text-foreground mt-4">
              No Inventory Items
            </h3>
            <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
              There are no inventory items to report on yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table
            columns={[
              { key: "itemName", header: "Item" },
              { key: "sku", header: "SKU" },
              {
                key: "quantity",
                header: "Quantity",
                render: (value) => Number(value ?? 0).toLocaleString(),
              },
              {
                key: "minQuantity",
                header: "Min",
                render: (value) => Number(value ?? 0).toLocaleString(),
              },
              {
                key: "lowStock",
                header: "Low Stock",
                render: (value) =>
                  value ? (
                    <Badge variant="warning">Low Stock</Badge>
                  ) : (
                    <Badge variant="success">OK</Badge>
                  ),
              },
            ]}
            data={rows as unknown as Record<string, unknown>[]}
            emptyMessage="No inventory items."
          />
        </Card>
      )}
    </div>
  );
};

export default InventorySection;

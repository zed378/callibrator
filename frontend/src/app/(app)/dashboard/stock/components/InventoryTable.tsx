import React from "react";
import { Stock } from "@/types";
import { Table, Badge, Button } from "@/components/ui";
import { AlertTriangle, Sliders, ArrowLeftRight } from "lucide-react";

interface InventoryTableProps {
  data: Stock[];
  hasWriteAccess: boolean;
  openAdjustment: (s: Stock) => void;
  openTransfer: (s: Stock) => void;
  openEditStock: (s: Stock) => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({
  data,
  hasWriteAccess,
  openAdjustment,
  openTransfer,
  openEditStock,
}) => {
  const columns = [
    {
      key: "itemName",
      header: "Item Description",
      render: (_: unknown, row: Record<string, unknown>) => {
        const s = row as unknown as Stock;
        const lowStock = s.quantity <= s.minQuantity;
        return (
          <div>
            <div className="font-semibold text-foreground">{s.itemName}</div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              {s.sku && <span>SKU: {s.sku}</span>}
              {s.serialNumber && <span>S/N: {s.serialNumber}</span>}
            </div>
            {lowStock && s.quantity > 0 && (
              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-warning">
                <AlertTriangle className="h-3 w-3" /> Low stock threshold reached
              </span>
            )}
            {s.quantity === 0 && (
              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-destructive">
                <AlertTriangle className="h-3 w-3" /> Out of stock
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "warehouse",
      header: "Location / Depot",
      render: (_: unknown, row: Record<string, unknown>) => {
        const s = row as unknown as Stock;
        return (
          <div>
            <div className="font-medium text-foreground">{s.warehouse?.name}</div>
            {s.location && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Shelf: {s.location.name} ({s.location.code})
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "quantity",
      header: "Stock Quantity",
      render: (_: unknown, row: Record<string, unknown>) => {
        const s = row as unknown as Stock;
        const lowStock = s.quantity <= s.minQuantity;
        return (
          <div>
            <span className={`text-base font-bold ${lowStock ? "text-destructive" : "text-foreground"}`}>
              {s.quantity} units
            </span>
            <div className="text-xs text-muted-foreground mt-0.5">Min safety: {s.minQuantity}</div>
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (_: unknown, row: Record<string, unknown>) => {
        const s = row as unknown as Stock;
        return (
          <div className="flex items-center justify-end gap-2">
            {hasWriteAccess ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => openAdjustment(s)} leftIcon={<Sliders className="h-4 w-4" />}>
                  Adjust
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openTransfer(s)} leftIcon={<ArrowLeftRight className="h-4 w-4" />}>
                  Transfer
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEditStock(s)}>
                  Edit
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => openEditStock(s)}>
                View Details
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return <Table columns={columns} data={data as unknown as Record<string, unknown>[]} emptyMessage="No stock levels found." />;
};

export default InventoryTable;

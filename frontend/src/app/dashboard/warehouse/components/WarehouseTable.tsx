import React from "react";
import { Warehouse } from "@/types";
import { Card, CardContent, Table, Pagination, Badge, Button, TableSkeleton } from "@/components/ui";
import { Warehouse as WarehouseIcon, MapPin, Edit, Trash2, Eye } from "lucide-react";

interface WarehouseTableProps {
  warehouseList: Warehouse[];
  isLoading: boolean;
  meta: any;
  hasWriteAccess: boolean;
  pageSize: number;
  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;
  openLocationsManager: (w: Warehouse) => void;
  openEditWarehouse: (w: Warehouse) => void;
  confirmDeleteWarehouse: (id: string) => void;
}

export const WarehouseTable: React.FC<WarehouseTableProps> = ({
  warehouseList,
  isLoading,
  meta,
  hasWriteAccess,
  setCurrentPage,
  setPageSize,
  openLocationsManager,
  openEditWarehouse,
  confirmDeleteWarehouse,
}) => {
  const getStatusBadge = (status: "active" | "suspended" | "inactive") => {
    const variants = {
      active: "success" as const,
      suspended: "danger" as const,
      inactive: "default" as const,
    };
    return <Badge variant={variants[status]}>{status.toUpperCase()}</Badge>;
  };

  const columns = [
    {
      key: "name",
      header: "Warehouse Name",
      render: (_: unknown, row: Record<string, unknown>) => {
        const w = row as unknown as Warehouse;
        return (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <WarehouseIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-foreground">{w.name}</div>
              <div className="text-xs text-muted-foreground">{w.code}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "address",
      header: "Address",
      render: (val: unknown) => (
        <span className="text-muted-foreground max-w-xs truncate block">
          {String(val || "-")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (val: unknown) => getStatusBadge(val as "active" | "suspended" | "inactive"),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (_: unknown, row: Record<string, unknown>) => {
        const w = row as unknown as Warehouse;
        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openLocationsManager(w)}
              leftIcon={<MapPin className="h-4 w-4" />}
            >
              Locations
            </Button>
            {hasWriteAccess ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditWarehouse(w)}
                  leftIcon={<Edit className="h-4 w-4" />}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => confirmDeleteWarehouse(w.id)}
                  leftIcon={<Trash2 className="h-4 w-4 text-destructive" />}
                  className="text-destructive hover:bg-destructive/10"
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEditWarehouse(w)}
                leftIcon={<Eye className="h-4 w-4" />}
              >
                View
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  if (isLoading) {
    return <TableSkeleton rows={5} cols={4} />;
  }

  return (
    <Card className="overflow-hidden">
      <Table
        columns={columns}
        data={warehouseList as unknown as Record<string, unknown>[]}
        emptyMessage="No warehouses found"
      />
      <div className="px-6 py-4 border-t border-border">
        <Pagination
          currentPage={meta.page}
          totalPages={meta.totalPages}
          totalItems={meta.total || 0}
          pageSize={meta.limit}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
          pageSizes={[5, 10, 25, 50]}
        />
      </div>
    </Card>
  );
};

export default WarehouseTable;

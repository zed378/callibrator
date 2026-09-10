import React from "react";
import { Device } from "@/api/services/device.service";
import { Card, CardContent, TableSkeleton, Table, Badge, Button, Pagination } from "@/components/ui";
import { ClipboardList, Calendar, Edit, Trash2 } from "lucide-react";

interface DevicesTableProps {
  devices: any;
  isDevicesLoading: boolean;
  pageSize: number;
  setCurrentPage: (page: number) => void;
  hasWriteAccess: boolean;
  openEditModal: (dev: Device) => void;
  handleDeleteClick: (id: string) => void;
}

export const DevicesTable: React.FC<DevicesTableProps> = ({
  devices,
  isDevicesLoading,
  pageSize,
  setCurrentPage,
  hasWriteAccess,
  openEditModal,
  handleDeleteClick,
}) => {
  const getStatusBadge = (status: Device["status"]) => {
    const maps = {
      active: { variant: "success" as const, label: "Active" },
      inactive: { variant: "secondary" as const, label: "Inactive" },
      maintenance: { variant: "warning" as const, label: "Maintenance" },
      retired: { variant: "danger" as const, label: "Retired" },
    };
    const current = maps[status] || { variant: "secondary" as const, label: status };
    return <Badge variant={current.variant}>{current.label}</Badge>;
  };

  const columns = [
    { key: "name", header: "Device Name" },
    { key: "serialNumber", header: "Serial Number" },
    { key: "manufacturer", header: "Manufacturer" },
    { key: "model", header: "Model" },
    { key: "category", header: "Category" },
    { key: "status", header: "Status" },
    { key: "location", header: "Warehouse Location" },
    { key: "nextCalibration", header: "Next Calibration" },
    { key: "actions", header: "Actions" },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isDevicesLoading ? (
          <TableSkeleton cols={columns.length} rows={5} />
        ) : !devices || devices.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No devices found</p>
            <p className="text-sm">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              data={devices.data.map((dev: Device) => ({
                ...dev,
                name: (
                  <div>
                    <div className="font-semibold text-foreground">{dev.name}</div>
                    <div className="text-xs text-muted-foreground">{dev.remarks || "No remarks"}</div>
                  </div>
                ),
                serialNumber: <span className="font-mono text-xs">{dev.serialNumber || "-"}</span>,
                manufacturer: dev.manufacturer || "-",
                model: dev.model || "-",
                category: dev.category || "-",
                status: getStatusBadge(dev.status),
                location: dev.warehouse ? (
                  <Badge variant="secondary" className="border-border">
                    {dev.warehouse.name} ({dev.warehouse.code})
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
                nextCalibration: dev.nextCalibrationDate ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    {new Date(dev.nextCalibrationDate).toLocaleDateString()}
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
                          onClick={() => openEditModal(dev)}
                          className="text-primary hover:text-primary hover:bg-muted"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(dev.id)}
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
                currentPage={devices.meta.page}
                totalPages={devices.meta.totalPages}
                totalItems={devices.meta.total ?? 0}
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

export default DevicesTable;

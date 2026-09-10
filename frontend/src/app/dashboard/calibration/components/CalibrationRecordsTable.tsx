import React from "react";
import { Calibration } from "@/api/services/calibration.service";
import { Card, CardContent, Table, TableSkeleton, Badge, Button, Pagination } from "@/components/ui";
import { Activity, PenTool } from "lucide-react";

interface CalibrationRecordsTableProps {
  calibrations: any;
  isCalibLoading: boolean;
  pageSize: number;
  onPageChange: (page: number) => void;
  hasWriteAccess: boolean;
  openCreateCertificateModal: (cal: Calibration) => void;
}

export const CalibrationRecordsTable: React.FC<CalibrationRecordsTableProps> = ({
  calibrations,
  isCalibLoading,
  pageSize,
  onPageChange,
  hasWriteAccess,
  openCreateCertificateModal,
}) => {
  const calibColumns = [
    {
      key: "device",
      header: "Device",
      render: (_: any, row: any) => {
        const cal = row as Calibration;
        return cal.device ? (
          <div>
            <div className="font-semibold text-foreground">{cal.device.name}</div>
            <div className="text-xs text-muted-foreground">SN: {cal.device.serialNumber}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">Unknown Device</span>
        );
      },
    },
    {
      key: "date",
      header: "Calibration Date",
      render: (_: any, row: any) => new Date((row as Calibration).calibrationDate).toLocaleDateString(),
    },
    {
      key: "standard",
      header: "Standard Used",
      render: (_: any, row: any) => (row as Calibration).standard || "Standard Limits",
    },
    {
      key: "isCompliant",
      header: "Status",
      render: (_: any, row: any) => (
        <Badge variant={(row as Calibration).isCompliant ? "success" : "danger"}>
          {(row as Calibration).isCompliant ? "Compliant" : "Non-Compliant"}
        </Badge>
      ),
    },
    {
      key: "technician",
      header: "Performed By",
      render: (_: any, row: any) => {
        const cal = row as Calibration;
        return cal.performer ? (
          <span className="text-xs">{cal.performer.firstName} {cal.performer.lastName}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: "notes",
      header: "Remarks",
      render: (_: any, row: any) => <span className="text-xs max-w-[200px] truncate block">{(row as Calibration).notes || "-"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (_: any, row: any) => {
        const cal = row as Calibration;
        return (
          <div className="flex items-center gap-2">
            {hasWriteAccess && cal.isCompliant && (
              <Button
                size="sm"
                variant="outline"
                className="flex items-center gap-1 text-xs"
                onClick={() => openCreateCertificateModal(cal)}
              >
                <PenTool className="h-3.5 w-3.5" />
                Certify
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isCalibLoading ? (
          <TableSkeleton cols={7} rows={5} />
        ) : !calibrations || calibrations.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No calibration records found</p>
            <p className="text-sm">Record a new calibration audit log to get started.</p>
          </div>
        ) : (
          <>
            <Table columns={calibColumns} data={calibrations.data} />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={calibrations.meta.page}
                totalPages={calibrations.meta.totalPages}
                totalItems={calibrations.meta.total ?? 0}
                pageSize={pageSize}
                onPageChange={onPageChange}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default CalibrationRecordsTable;

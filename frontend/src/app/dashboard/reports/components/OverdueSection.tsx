// src/app/dashboard/reports/components/OverdueSection.tsx
import React from "react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { Table } from "@/components/ui/Table";
import { Download, CheckCircle2 } from "lucide-react";
import { OverdueDevicesReport } from "@/api/services/report.service";
import { MetricCard } from "./ReportCards";

interface OverdueSectionProps {
  overdue: OverdueDevicesReport | null;
  onExport: () => void;
  isExporting: boolean;
}

export const OverdueSection: React.FC<OverdueSectionProps> = ({
  overdue,
  onExport,
  isExporting,
}) => {
  const rows = overdue?.rows || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="w-full sm:w-64">
          <MetricCard
            title="Overdue Devices"
            value={overdue?.total ?? 0}
            valueClassName={
              (overdue?.total ?? 0) > 0 ? "text-destructive" : "text-success"
            }
          />
        </div>
        <Button
          variant="secondary"
          leftIcon={<Download className="h-4 w-4" />}
          onClick={onExport}
          isLoading={isExporting}
        >
          Export CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-16 text-center">
            <CheckCircle2 className="mx-auto h-16 w-16 text-success" />
            <h3 className="text-xl font-semibold text-foreground mt-4">
              No Overdue Devices
            </h3>
            <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
              All devices are within their calibration schedule.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table
            columns={[
              { key: "name", header: "Device" },
              { key: "serialNumber", header: "Serial" },
              { key: "category", header: "Category" },
              {
                key: "nextCalibrationDate",
                header: "Due Date",
                render: (value) =>
                  value ? new Date(String(value)).toLocaleDateString() : "-",
              },
              {
                key: "daysOverdue",
                header: "Days Overdue",
                render: (value) => (
                  <Badge variant="danger">
                    {Number(value ?? 0).toLocaleString()} days
                  </Badge>
                ),
              },
            ]}
            data={rows as unknown as Record<string, unknown>[]}
            emptyMessage="No overdue devices."
          />
        </Card>
      )}
    </div>
  );
};

export default OverdueSection;

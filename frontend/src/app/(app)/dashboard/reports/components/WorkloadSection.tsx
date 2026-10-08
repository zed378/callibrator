// src/app/dashboard/reports/components/WorkloadSection.tsx
import React from "react";
import { Card, CardContent } from "@/components/ui";
import { CalibrationWorkload } from "@/api/services/report.service";
import { MetricCard, BreakdownCard } from "./ReportCards";

interface WorkloadSectionProps {
  workload: CalibrationWorkload | null;
}

export const WorkloadSection: React.FC<WorkloadSectionProps> = ({
  workload,
}) => {
  if (!workload) {
    return (
      <Card>
        <CardContent className="p-16 text-center">
          <p className="text-sm text-muted-foreground">
            No workload data available yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Upcoming Calibrations Due
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Due in 30 Days"
            value={workload.upcomingDue.in30Days}
            valueClassName={
              workload.upcomingDue.in30Days > 0
                ? "text-destructive"
                : "text-success"
            }
          />
          <MetricCard
            title="Due in 60 Days"
            value={workload.upcomingDue.in60Days}
            valueClassName={
              workload.upcomingDue.in60Days > 0
                ? "text-warning"
                : "text-success"
            }
          />
          <MetricCard
            title="Due in 90 Days"
            value={workload.upcomingDue.in90Days}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Work Orders
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BreakdownCard
            title="By Status"
            data={workload.workOrders.byStatus}
            emptyMessage="No work orders."
          />
          <BreakdownCard
            title="By Type"
            data={workload.workOrders.byType}
            emptyMessage="No work orders."
          />
          <BreakdownCard
            title="By Priority"
            data={workload.workOrders.byPriority}
            emptyMessage="No work orders."
          />
        </div>
      </div>
    </div>
  );
};

export default WorkloadSection;

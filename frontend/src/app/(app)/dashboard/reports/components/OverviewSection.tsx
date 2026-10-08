// src/app/dashboard/reports/components/OverviewSection.tsx
import React from "react";
import { Card, CardContent } from "@/components/ui";
import { ReportSummary } from "@/api/services/report.service";
import { MetricCard, BreakdownCard } from "./ReportCards";

interface OverviewSectionProps {
  summary: ReportSummary | null;
}

export const OverviewSection: React.FC<OverviewSectionProps> = ({
  summary,
}) => {
  if (!summary) {
    return (
      <Card>
        <CardContent className="p-16 text-center">
          <p className="text-sm text-muted-foreground">
            No report data available yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Overdue Devices"
          value={summary.devices.overdue}
          subtitle="Past their calibration due date"
          valueClassName={
            summary.devices.overdue > 0 ? "text-destructive" : "text-success"
          }
        />
        <MetricCard
          title="Compliance Rate"
          value={`${summary.compliance.complianceRate}%`}
          subtitle={`${summary.compliance.compliant.toLocaleString()} of ${summary.compliance.total.toLocaleString()} devices compliant`}
          valueClassName={
            summary.compliance.complianceRate >= 90
              ? "text-success"
              : summary.compliance.complianceRate >= 70
                ? "text-warning"
                : "text-destructive"
          }
        />
        <MetricCard
          title="Inventory Items"
          value={summary.inventory.totalItems}
          subtitle={`${summary.inventory.totalQuantity.toLocaleString()} total units`}
        />
        <MetricCard
          title="Low Stock Items"
          value={summary.inventory.lowStockCount}
          subtitle="At or below minimum quantity"
          valueClassName={
            summary.inventory.lowStockCount > 0
              ? "text-warning"
              : "text-success"
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BreakdownCard
          title="Devices by Status"
          data={summary.devices.byStatus}
          emptyMessage="No devices registered."
        />
        <BreakdownCard
          title="Certificates by Status"
          data={summary.certificates.byStatus}
          emptyMessage="No certificates issued."
        />
        <BreakdownCard
          title="Work Orders by Status"
          data={summary.workOrders.byStatus}
          emptyMessage="No work orders created."
        />
      </div>
    </div>
  );
};

export default OverviewSection;

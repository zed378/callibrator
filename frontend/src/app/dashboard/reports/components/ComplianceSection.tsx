// src/app/dashboard/reports/components/ComplianceSection.tsx
import React from "react";
import { Button, Card, CardContent, Input } from "@/components/ui";
import { Download } from "lucide-react";
import { ComplianceReport } from "@/api/services/report.service";
import { MetricCard } from "./ReportCards";

interface ComplianceSectionProps {
  compliance: ComplianceReport | null;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: () => void;
  onExport: () => void;
  isExporting: boolean;
}

export const ComplianceSection: React.FC<ComplianceSectionProps> = ({
  compliance,
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
  onExport,
  isExporting,
}) => {
  const summary = compliance?.summary;

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="w-full sm:w-56">
              <Input
                type="date"
                label="From"
                value={from}
                onChange={(e) => onFromChange(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-56">
              <Input
                type="date"
                label="To"
                value={to}
                onChange={(e) => onToChange(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={onApply}>
                Apply
              </Button>
              <Button
                variant="secondary"
                leftIcon={<Download className="h-4 w-4" />}
                onClick={onExport}
                isLoading={isExporting}
              >
                Export CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!summary ? (
        <Card>
          <CardContent className="p-16 text-center">
            <p className="text-sm text-muted-foreground">
              No compliance data available for the selected period.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard title="Total Devices" value={summary.total} />
          <MetricCard
            title="Compliant"
            value={summary.compliant}
            valueClassName="text-success"
          />
          <MetricCard
            title="Non-Compliant"
            value={summary.nonCompliant}
            valueClassName={
              summary.nonCompliant > 0 ? "text-destructive" : "text-foreground"
            }
          />
          <MetricCard
            title="Unknown"
            value={summary.unknown}
            valueClassName={
              summary.unknown > 0 ? "text-warning" : "text-foreground"
            }
          />
          <MetricCard
            title="Compliance Rate"
            value={`${summary.complianceRate}%`}
            valueClassName={
              summary.complianceRate >= 90
                ? "text-success"
                : summary.complianceRate >= 70
                  ? "text-warning"
                  : "text-destructive"
            }
          />
        </div>
      )}
    </div>
  );
};

export default ComplianceSection;

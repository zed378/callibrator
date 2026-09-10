// src/app/dashboard/reports/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, CardSkeleton, Skeleton } from "@/components/ui";
import { useReports, ReportsTab } from "./hooks/useReports";
import OverviewSection from "./components/OverviewSection";
import ComplianceSection from "./components/ComplianceSection";
import WorkloadSection from "./components/WorkloadSection";
import OverdueSection from "./components/OverdueSection";
import InventorySection from "./components/InventorySection";

const TABS: { key: ReportsTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "compliance", label: "Compliance" },
  { key: "workload", label: "Workload" },
  { key: "overdue", label: "Overdue Devices" },
  { key: "inventory", label: "Inventory" },
];

const LoadingState: React.FC = () => (
  <div className="space-y-6">
    <CardSkeleton cards={3} />
    <Skeleton className="h-64 w-full rounded-2xl" />
  </div>
);

export default function ReportsPage() {
  const {
    activeTab,
    handleTabChange,
    isLoading,
    error,
    isExporting,
    summary,
    compliance,
    workload,
    overdue,
    inventory,
    complianceFrom,
    setComplianceFrom,
    complianceTo,
    setComplianceTo,
    handleApplyComplianceRange,
    handleExportCompliance,
    handleExportOverdue,
    handleExportInventory,
  } = useReports();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Compliance, calibration workload, overdue devices and inventory
            insights.
          </p>
        </div>

        <div className="flex border-b border-border overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-5 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {isLoading ? (
          <LoadingState />
        ) : (
          <>
            {activeTab === "overview" && <OverviewSection summary={summary} />}
            {activeTab === "compliance" && (
              <ComplianceSection
                compliance={compliance}
                from={complianceFrom}
                to={complianceTo}
                onFromChange={setComplianceFrom}
                onToChange={setComplianceTo}
                onApply={handleApplyComplianceRange}
                onExport={handleExportCompliance}
                isExporting={isExporting}
              />
            )}
            {activeTab === "workload" && (
              <WorkloadSection workload={workload} />
            )}
            {activeTab === "overdue" && (
              <OverdueSection
                overdue={overdue}
                onExport={handleExportOverdue}
                isExporting={isExporting}
              />
            )}
            {activeTab === "inventory" && (
              <InventorySection
                inventory={inventory}
                onExport={handleExportInventory}
                isExporting={isExporting}
              />
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

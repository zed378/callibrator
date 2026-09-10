// src/app/dashboard/stock/components/ReportsTab.tsx
import React from "react";
import { Card, CardHeader, CardContent, Button } from "@/components/ui";
import { Layers, Package, AlertTriangle, TrendingUp, Download } from "lucide-react";

interface WarehouseDistribution {
  id: string;
  name: string;
  code: string;
  unitCount: number;
  itemCount: number;
}

interface ReportSummary {
  totalItems: number;
  totalUnits: number;
  lowStockCount: number;
  warehouseDistribution: WarehouseDistribution[];
}

interface ReportsTabProps {
  reportSummary: ReportSummary | null;
  onExportStocks: () => void;
  onExportTransfers: () => void;
  onExportAdjustments: () => void;
  onExportOpnames: () => void;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  reportSummary,
  onExportStocks,
  onExportTransfers,
  onExportAdjustments,
  onExportOpnames,
}) => {
  const lowStockCount = reportSummary?.lowStockCount ?? 0;

  return (
    <div className="space-y-8">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="relative overflow-hidden bg-card shadow-sm border border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Total Unique Items</p>
                <h3 className="text-3xl font-extrabold text-foreground mt-2">
                  {reportSummary?.totalItems ?? 0}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Different stock lines cataloged</p>
              </div>
              <div className="p-3 bg-primary/10 text-primary rounded-xl">
                <Layers className="h-6 w-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-card shadow-sm border border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Total Cumulative Units</p>
                <h3 className="text-3xl font-extrabold text-foreground mt-2">
                  {reportSummary?.totalUnits ?? 0}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Total count of items across all depots</p>
              </div>
              <div className="p-3 bg-success/10 text-success rounded-xl">
                <Package className="h-6 w-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`relative overflow-hidden bg-card shadow-sm border ${
          lowStockCount > 0 
            ? "border-destructive/30 bg-destructive/10" 
            : "border-border"
        }`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Low Stock Alerts</p>
                <h3 className={`text-3xl font-extrabold mt-2 ${
                  lowStockCount > 0 
                    ? "text-destructive" 
                    : "text-foreground"
                }`}>
                  {lowStockCount}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Items below safety stock threshold</p>
              </div>
              <div className={`p-3 rounded-xl ${
                lowStockCount > 0
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}>
                <AlertTriangle className="h-6 w-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Warehouse Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 shadow-sm border border-border bg-card">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" /> Stock Level by Depot
              </span>
            }
            subtitle="Proportional unit count distribution across registered locations."
          />
          <CardContent className="p-6 divide-y divide-border">
            {reportSummary?.warehouseDistribution && reportSummary.warehouseDistribution.length > 0 ? (
              reportSummary.warehouseDistribution.map((wh) => {
                const totalUnits = reportSummary.totalUnits || 1;
                const percentage = Math.min(100, Math.round((wh.unitCount / totalUnits) * 100));
                return (
                  <div key={wh.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <div>
                        <span className="font-semibold text-foreground">{wh.name}</span>
                        <span className="text-xs text-muted-foreground ml-1.5 font-mono bg-muted px-1.5 py-0.5 rounded">
                          {wh.code}
                        </span>
                      </div>
                      <span className="font-medium text-foreground">
                        {wh.unitCount} units ({wh.itemCount} items)
                      </span>
                    </div>
                    <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-primary h-full rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No stock distribution data available.
              </div>
            )}
          </CardContent>
        </Card>

        {/* CSV Export Panel */}
        <Card className="shadow-sm border border-border bg-card">
          <CardHeader
            title="Export & Reporting"
            subtitle="Download formatted spreadsheet reports directly."
          />
          <CardContent className="p-6 space-y-4">
            <Button
              variant="secondary"
              className="w-full justify-start text-left"
              leftIcon={<Download className="h-4.5 w-4.5 text-muted-foreground" />}
              onClick={onExportStocks}
            >
              Export Stock Levels
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start text-left"
              leftIcon={<Download className="h-4.5 w-4.5 text-muted-foreground" />}
              onClick={onExportTransfers}
            >
              Export Inter-depot Transfers
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start text-left"
              leftIcon={<Download className="h-4.5 w-4.5 text-muted-foreground" />}
              onClick={onExportAdjustments}
            >
              Export Manual Adjustments
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start text-left"
              leftIcon={<Download className="h-4.5 w-4.5 text-muted-foreground" />}
              onClick={onExportOpnames}
            >
              Export Audit Counts (Opname)
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ReportsTab;

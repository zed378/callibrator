// src/app/dashboard/calibration-scheduler/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Button,
  Input,
  Card,
  CardContent,
  Badge,
  Alert,
  Table,
  TableSkeleton,
} from "@/components/ui";
import { CalendarClock, Play, RefreshCw } from "lucide-react";
import { useScheduler } from "./hooks/useScheduler";
import { DueDevice } from "@/api/services/calibrationScheduler.service";

const passthrough = (value: unknown) => value as React.ReactNode;

const getStatusBadge = (device: DueDevice) =>
  device.overdue ? (
    <Badge variant="danger">Overdue</Badge>
  ) : (
    <Badge variant="warning">Due soon</Badge>
  );

export default function CalibrationSchedulerPage() {
  const {
    isSuperAdmin,
    leadDays,
    handleLeadDaysChange,
    allTenants,
    setAllTenants,
    dueDevices,
    isLoading,
    error,
    fetchDue,
    isRunning,
    handleRun,
    lastRun,
    clearLastRun,
  } = useScheduler();

  const columns = [
    { key: "device", header: "Device", render: passthrough },
    { key: "nextDate", header: "Next Calibration Date", render: passthrough },
    { key: "interval", header: "Interval (days)", render: passthrough },
    { key: "status", header: "Status", render: passthrough },
  ];

  const statCards: { label: string; value: number; className?: string }[] =
    lastRun
      ? [
          { label: "Scanned", value: lastRun.scanned },
          {
            label: "Work Orders Created",
            value: lastRun.workOrdersCreated,
            className: "text-success",
          },
          { label: "Skipped", value: lastRun.skipped },
          {
            label: "Overdue",
            value: lastRun.overdue,
            className: "text-warning",
          },
          {
            label: "Errors",
            value: lastRun.errors,
            className: lastRun.errors > 0 ? "text-destructive" : undefined,
          },
        ]
      : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Calibration Scheduler
          </h1>
          <p className="text-sm text-muted-foreground">
            Review devices due for calibration and generate preventative work
            orders.
          </p>
        </div>

        {/* Controls */}
        <Card className="border-border">
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div className="w-full sm:w-48">
                <Input
                  type="number"
                  label="Look-ahead (days)"
                  min={0}
                  value={leadDays}
                  onChange={handleLeadDaysChange}
                />
              </div>

              {isSuperAdmin && (
                <label className="flex items-center gap-2 pb-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allTenants}
                    onChange={(e) => setAllTenants(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm font-medium text-foreground">
                    All tenants
                  </span>
                </label>
              )}

              <div className="flex items-center gap-2 sm:ml-auto pb-0.5">
                <Button
                  variant="outline"
                  onClick={fetchDue}
                  disabled={isLoading || isRunning}
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                >
                  Refresh
                </Button>
                <Button
                  onClick={handleRun}
                  isLoading={isRunning}
                  disabled={isRunning}
                  leftIcon={<Play className="h-4 w-4" />}
                >
                  {isRunning ? "Running..." : "Run Scheduler"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Last run summary */}
        {lastRun && (
          <div className="space-y-4">
            <Alert
              variant={lastRun.errors > 0 ? "warning" : "success"}
              title="Scheduler run complete"
              onClose={clearLastRun}
            >
              {lastRun.workOrdersCreated} work order(s) and{" "}
              {lastRun.notificationsCreated} notification(s) created.{" "}
              {lastRun.skipped} device(s) skipped (already scheduled).
            </Alert>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {statCards.map((stat) => (
                <Card key={stat.label} className="border-border">
                  <CardContent className="p-4 text-center">
                    <p
                      className={`text-2xl font-bold ${
                        stat.className || "text-foreground"
                      }`}
                    >
                      {stat.value}
                    </p>
                    <p className="text-xs font-medium text-muted-foreground mt-1">
                      {stat.label}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        {/* Due devices table */}
        <Card className="border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4">
                <TableSkeleton cols={columns.length} rows={5} />
              </div>
            ) : dueDevices.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CalendarClock className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-lg font-medium">
                  No devices due within {leadDays} days
                </p>
                <p className="text-sm">
                  Increase the look-ahead window to see more devices.
                </p>
              </div>
            ) : (
              <Table
                columns={columns}
                data={dueDevices.map((device) => ({
                  device: (
                    <div>
                      <div className="font-semibold text-foreground">
                        {device.name}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {device.serialNumber || "No serial number"}
                      </div>
                    </div>
                  ),
                  nextDate: (
                    <span
                      className={
                        device.overdue
                          ? "text-destructive font-semibold"
                          : "text-foreground"
                      }
                    >
                      {new Date(
                        device.nextCalibrationDate,
                      ).toLocaleDateString()}
                    </span>
                  ),
                  interval:
                    device.calibrationIntervalDays != null
                      ? String(device.calibrationIntervalDays)
                      : "-",
                  status: getStatusBadge(device),
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

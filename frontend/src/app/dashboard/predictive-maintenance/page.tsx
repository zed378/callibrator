// src/app/dashboard/predictive-maintenance/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Select,
  Table,
} from "@/components/ui";
import { Activity, Check, RefreshCw } from "lucide-react";
import {
  predictiveMaintenanceService,
  type PredictiveRecommendation,
} from "@/api/services/predictiveMaintenance.service";
import { deviceService, type Device } from "@/api/services/device.service";
import { useToastStore } from "@/stores/toastStore";

export default function PredictiveMaintenancePage() {
  const addToast = useToastStore((s) => s.addToast);

  const [recommendations, setRecommendations] = useState<
    PredictiveRecommendation[]
  >([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await predictiveMaintenanceService.getRecommendations();
      setRecommendations(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load recommendations",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    deviceService
      .getAll(1, 100)
      .then((res) => setDevices(res.data ?? []))
      .catch(() => setDevices([]));
  }, []);

  const analyze = async () => {
    if (!selectedDeviceId) {
      addToast({ type: "error", title: "Select a device to analyze" });
      return;
    }
    setIsAnalyzing(true);
    try {
      const result =
        await predictiveMaintenanceService.analyzeDevice(selectedDeviceId);

      if (result.status === "skipped") {
        addToast({
          type: "info",
          title: "Not enough data",
          description:
            "At least 10 IoT readings in the last 30 days are required to analyze this device.",
        });
      } else if (result.status === "unchanged") {
        addToast({
          type: "info",
          title: "Interval already optimal",
          description: "No change to the calibration interval is recommended.",
        });
      } else {
        addToast({
          type: "success",
          title: "Recommendation generated",
          description: result.recommendationReason ?? undefined,
        });
      }
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Analysis failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const approve = async (deviceId: string) => {
    setApprovingId(deviceId);
    try {
      await predictiveMaintenanceService.approveRecommendation(deviceId);
      addToast({
        type: "success",
        title: "Recommendation applied",
        description: "The device's calibration interval has been updated.",
      });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Approval failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setApprovingId(null);
    }
  };

  const columns = [
    { key: "name", header: "Device", className: "w-[18%]" },
    {
      key: "serialNumber",
      header: "Serial",
      className: "w-[16%]",
      render: (value: unknown) => String(value ?? "—"),
    },
    {
      key: "calibrationIntervalDays",
      header: "Current Interval",
      className: "w-[13%]",
      render: (value: unknown) => (value ? `${String(value)} days` : "—"),
    },
    {
      key: "recommendedCalibrationInterval",
      header: "Recommended",
      className: "w-[12%]",
      render: (_value: unknown, row: Record<string, unknown>) => {
        const current = Number(row.calibrationIntervalDays ?? 0);
        const rec = Number(row.recommendedCalibrationInterval ?? 0);
        // Shorter interval = more frequent calibration = higher risk signal.
        const variant =
          !current || rec === current ? "default" : rec < current ? "warning" : "success";
        return (
          <Badge variant={variant} size="sm">
            {rec} days
          </Badge>
        );
      },
    },
    {
      key: "recommendationReason",
      header: "Reason",
      className: "w-[27%]",
      render: (value: unknown) => (
        // Wrap instead of nowrap: the base cell is whitespace-nowrap, which made
        // this long text spill out of its fixed-width column and overlap the
        // Actions button. A block child with whitespace-normal wraps within the
        // column and grows the row height instead.
        <span className="block whitespace-normal wrap-break-word text-sm text-muted-foreground">
          {String(value ?? "—")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[14%]",
      render: (_value: unknown, row: Record<string, unknown>) => {
        const id = String(row.id);
        return (
          <Button
            size="sm"
            variant="outline"
            isLoading={approvingId === id}
            onClick={() => approve(id)}
            leftIcon={<Check className="h-4 w-4" />}
          >
            Approve
          </Button>
        );
      },
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Predictive Maintenance
            </h1>
            <p className="text-sm text-muted-foreground">
              Calibration-interval recommendations derived from IoT anomaly
              rates.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void load()}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Refresh
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1.5">
                  Analyze a device
                </label>
                <Select
                  value={selectedDeviceId}
                  onChange={setSelectedDeviceId}
                  placeholder="Select an IoT-enabled device"
                  options={devices.map((d) => ({
                    value: d.id,
                    label: d.serialNumber
                      ? `${d.name} (${d.serialNumber})`
                      : d.name,
                  }))}
                />
              </div>
              <Button
                onClick={analyze}
                isLoading={isAnalyzing}
                leftIcon={<Activity className="h-4 w-4" />}
              >
                Run Analysis
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Analysis requires an IoT-enabled device with a baseline interval
              and at least 10 readings in the last 30 days.
            </p>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold mb-3">Pending Recommendations</h2>
          <Table
            columns={columns}
            data={recommendations as unknown as Record<string, unknown>[]}
            isLoading={isLoading}
            emptyMessage="No pending recommendations. Run an analysis to generate one."
          />
        </div>
      </div>
    </DashboardLayout>
  );
}

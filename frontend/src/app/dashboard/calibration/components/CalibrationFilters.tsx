import React from "react";
import { Card, CardContent, Select, Input } from "@/components/ui";

interface RecordsFilterCardProps {
  selectedDeviceFilter: string;
  setSelectedDeviceFilter: (val: string) => void;
  complianceFilter: boolean | null;
  setComplianceFilter: (val: boolean | null) => void;
  devices: any;
  setCalibPage: (page: number) => void;
}

export const RecordsFilterCard: React.FC<RecordsFilterCardProps> = ({
  selectedDeviceFilter,
  setSelectedDeviceFilter,
  complianceFilter,
  setComplianceFilter,
  devices,
  setCalibPage,
}) => {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-4 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-full sm:w-1/2">
          <Select
            value={selectedDeviceFilter}
            onChange={(val) => {
              setSelectedDeviceFilter(val);
              setCalibPage(1);
            }}
            options={[
              { value: "", label: "All Calibration Devices" },
              ...(devices?.data.map((d: any) => ({
                value: d.id,
                label: d.name,
              })) || []),
            ]}
          />
        </div>
        <div className="w-full sm:w-1/2">
          <Select
            value={complianceFilter === null ? "" : String(complianceFilter)}
            onChange={(val) => {
              setComplianceFilter(val === "" ? null : val === "true");
              setCalibPage(1);
            }}
            options={[
              { value: "", label: "All Compliance Statuses" },
              { value: "true", label: "Compliant" },
              { value: "false", label: "Non-Compliant" },
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
};

interface CertificatesFilterCardProps {
  certNumFilter: string;
  setCertNumFilter: (val: string) => void;
  certStatusFilter: string[];
  setCertStatusFilter: (val: string[]) => void;
  setCertPage: (page: number) => void;
}

export const CertificatesFilterCard: React.FC<CertificatesFilterCardProps> = ({
  certNumFilter,
  setCertNumFilter,
  certStatusFilter,
  setCertStatusFilter,
  setCertPage,
}) => {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-4 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-full sm:w-1/2">
          <Input
            placeholder="Search by certificate number..."
            value={certNumFilter}
            onChange={(e) => {
              setCertNumFilter(e.target.value);
              setCertPage(1);
            }}
          />
        </div>
        <div className="w-full sm:w-1/2">
          <Select
            value={certStatusFilter[0] || ""}
            onChange={(val) => {
              setCertStatusFilter(val ? [val] : []);
              setCertPage(1);
            }}
            options={[
              { value: "", label: "All Certificate Statuses" },
              { value: "draft", label: "Draft" },
              { value: "pending_approval", label: "Pending Approval" },
              { value: "approved", label: "Approved" },
              { value: "signed", label: "Signed & Locked" },
              { value: "revoked", label: "Revoked" },
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
};

import React, { useState } from "react";
import { Certificate } from "@/api/services/calibration.service";
import { Card, CardContent, Table, TableSkeleton, Badge, Button, Pagination } from "@/components/ui";
import { FileText, PenTool, Download } from "lucide-react";
import { useToastStore } from "@/stores/toastStore";
import { generateCertificatePdf } from "@/lib/certificatePdf";
import { PaginatedResponse } from "@/types";

// Table rows arrive as generic records; narrow them back to Certificate.
const asCert = (row: Record<string, unknown>): Certificate =>
  row as unknown as Certificate;

interface CertificatesTableProps {
  certificates: PaginatedResponse<Certificate> | null;
  isCalibLoading: boolean;
  pageSize: number;
  onPageChange: (page: number) => void;
  hasWriteAccess: boolean;
  /** Approval needs e-signature credentials, so it opens a modal. */
  openApproveModal: (cert: Certificate) => void;
  openSignModal: (cert: Certificate) => void;
  openRevokeModal: (cert: Certificate) => void;
}

export const CertificatesTable: React.FC<CertificatesTableProps> = ({
  certificates,
  isCalibLoading,
  pageSize,
  onPageChange,
  hasWriteAccess,
  openApproveModal,
  openSignModal,
  openRevokeModal,
}) => {
  const { addToast } = useToastStore();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // PDF is rendered entirely client-side from the certificate record.
  const handleDownloadPdf = async (cert: Certificate) => {
    setDownloadingId(cert.id);
    try {
      await generateCertificatePdf(cert);
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error ? err.message : "Failed to generate certificate PDF",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const getCertStatusBadge = (status: Certificate["status"]) => {
    const maps = {
      draft: { variant: "secondary" as const, label: "Draft" },
      pending_approval: { variant: "warning" as const, label: "Pending Approval" },
      approved: { variant: "info" as const, label: "Approved" },
      signed: { variant: "success" as const, label: "Signed & Locked" },
      revoked: { variant: "danger" as const, label: "Revoked" },
    };
    const current = maps[status] || { variant: "secondary" as const, label: status };
    return <Badge variant={current.variant}>{current.label}</Badge>;
  };

  const certColumns = [
    {
      key: "certificateNumber",
      header: "Cert Number",
      render: (_: unknown, row: Record<string, unknown>) => (
        <span className="font-mono font-bold text-primary">
          {(asCert(row)).certificateNumber}
        </span>
      ),
    },
    {
      key: "device",
      header: "Device",
      render: (_: unknown, row: Record<string, unknown>) => {
        const cert = asCert(row);
        return cert.device ? (
          <div>
            <div className="font-semibold text-foreground">{cert.device.name}</div>
            <div className="text-xs text-muted-foreground">SN: {cert.device.serialNumber}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">Unknown Device</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (_: unknown, row: Record<string, unknown>) => getCertStatusBadge((asCert(row)).status),
    },
    {
      key: "type",
      header: "Type",
      render: (_: unknown, row: Record<string, unknown>) => <Badge variant="secondary">{(asCert(row)).type}</Badge>,
    },
    {
      key: "standard",
      header: "Standard",
      render: (_: unknown, row: Record<string, unknown>) => (asCert(row)).standard || "-",
    },
    {
      key: "validUntil",
      header: "Valid Until",
      render: (_: unknown, row: Record<string, unknown>) => {
        const val = (asCert(row)).validUntil;
        return val ? new Date(val).toLocaleDateString() : "-";
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (_: unknown, row: Record<string, unknown>) => {
        const cert = asCert(row);
        return (
          <div className="flex items-center gap-1.5">
            {hasWriteAccess && cert.status === "draft" && (
              <Button size="sm" variant="outline" onClick={() => openApproveModal(cert)}>
                Approve
              </Button>
            )}
            {hasWriteAccess && cert.status === "approved" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openSignModal(cert)}
                className="flex items-center gap-1 text-success hover:text-success"
              >
                <PenTool className="h-3.5 w-3.5" />
                E-Sign
              </Button>
            )}
            {hasWriteAccess && cert.status !== "revoked" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-muted"
                onClick={() => openRevokeModal(cert)}
              >
                Revoke
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              isLoading={downloadingId === cert.id}
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1"
              onClick={() => handleDownloadPdf(cert)}
              title="Download certificate PDF"
            >
              <Download className="h-4 w-4" />
              PDF
            </Button>
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
        ) : !certificates || certificates.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No certificates found</p>
            <p className="text-sm">Certify a compliant calibration record to generate a certificate.</p>
          </div>
        ) : (
          <>
            <Table
              columns={certColumns}
              data={certificates.data as unknown as Record<string, unknown>[]}
            />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={certificates.meta.page}
                totalPages={certificates.meta.totalPages}
                totalItems={certificates.meta.total ?? 0}
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

export default CertificatesTable;

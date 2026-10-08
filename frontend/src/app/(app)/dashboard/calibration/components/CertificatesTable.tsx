import React, { useState } from "react";
import { Certificate, calibrationService } from "@/api/services/calibration.service";
import { Card, CardContent, Table, TableSkeleton, Badge, Button, Pagination } from "@/components/ui";
import { FileText, PenTool, Download } from "lucide-react";
import { useToastStore } from "@/stores/toastStore";
import { downloadCertificatePdf } from "@/lib/certificatePdf";
import { PaginatedResponse } from "@/types";
import { isCertificateAuthor } from "../certificateAuthorship";
import { StatusBadge } from "@/components/ui/StatusBadge";

// Table rows arrive as generic records; narrow them back to Certificate.
const asCert = (row: Record<string, unknown>): Certificate =>
  row as unknown as Certificate;

interface CertificatesTableProps {
  certificates: PaginatedResponse<Certificate> | null;
  isCalibLoading: boolean;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** ADR-102: `certificate` write, from the effective permission. */
  hasWriteAccess: boolean;
  /** The signed-in user — ADR-101: a certificate's author may not approve it. */
  currentUserId?: string | null;
  /** draft → pending_approval (POST /certificates/:id/submit). No button without it. */
  onSubmitCertificate?: (cert: Certificate) => void;
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
  currentUserId,
  onSubmitCertificate,
  openApproveModal,
  openSignModal,
  openRevokeModal,
}) => {
  const { addToast } = useToastStore();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // M-11 (ADR-095): the PDF is rendered in the browser from the certificate
  // DOCUMENT the backend serves — every printed field, the verification URL the
  // QR carries, and the integrity hash the public verification page recomputes.
  const handleDownloadPdf = async (cert: Certificate) => {
    setDownloadingId(cert.id);
    try {
      await downloadCertificatePdf(await calibrationService.getCertificateDocument(cert.id));
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
return <StatusBadge domain="certificate" state={status} />;
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
        // The actions follow the backend state machine (certificate.service
        // TRANSITION_REFUSALS): draft → submit; pending_approval → approve (by
        // someone other than its author, ADR-101); approved → sign; any state
        // but revoked → revoke.
        const selfAuthored = isCertificateAuthor(cert, currentUserId);
        const sodNoteId = `cert-${cert.id}-sod`;
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {hasWriteAccess && onSubmitCertificate && cert.status === "draft" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSubmitCertificate(cert)}
                aria-label={`Submit certificate ${cert.certificateNumber} for approval`}
              >
                Submit for approval
              </Button>
            )}
            {hasWriteAccess && cert.status === "pending_approval" && !selfAuthored && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openApproveModal(cert)}
                aria-label={`Approve certificate ${cert.certificateNumber}`}
              >
                Approve
              </Button>
            )}
            {hasWriteAccess && cert.status === "pending_approval" && selfAuthored && (
              <>
                <Button size="sm" variant="outline" disabled aria-describedby={sodNoteId}>
                  Approve
                </Button>
                <span id={sodNoteId} className="text-xs text-muted-foreground max-w-[16rem]">
                  Another user must approve it: you drafted or submitted this certificate
                  (separation of duties).
                </span>
              </>
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
              aria-label={`Download PDF of certificate ${cert.certificateNumber}`}
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

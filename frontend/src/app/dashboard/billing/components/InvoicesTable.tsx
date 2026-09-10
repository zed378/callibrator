// src/app/dashboard/billing/components/InvoicesTable.tsx
import React from "react";
import {
  Card,
  CardHeader,
  CardContent,
  Table,
  Pagination,
  Badge,
  Alert,
  Select,
  TableSkeleton,
} from "@/components/ui";
import { FileText, ExternalLink } from "lucide-react";
import {
  Invoice,
  InvoiceStatus,
  ListMeta,
} from "@/api/services/billing.service";

interface InvoicesTableProps {
  invoices: Invoice[];
  meta: ListMeta;
  isLoading: boolean;
  error: string | null;
  statusFilter: InvoiceStatus | "";
  onStatusFilterChange: (value: string) => void;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "-";

const shortId = (value?: string | null) =>
  value ? `${value.slice(0, 8)}…` : "-";

const formatAmount = (currency: string, amount: string | number) => {
  const numeric = Number(amount);
  return `${(currency || "").toUpperCase()} ${
    Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00"
  }`;
};

const getStatusBadge = (status: Invoice["status"]) => {
  const maps: Record<
    Invoice["status"],
    { variant: "success" | "info" | "default" | "danger"; label: string }
  > = {
    Paid: { variant: "success", label: "Paid" },
    Open: { variant: "info", label: "Open" },
    Draft: { variant: "default", label: "Draft" },
    Uncollectible: { variant: "danger", label: "Uncollectible" },
    Void: { variant: "danger", label: "Void" },
  };
  const current = maps[status] || {
    variant: "default" as const,
    label: status,
  };
  return <Badge variant={current.variant}>{current.label}</Badge>;
};

const passthrough = (value: unknown) => value as React.ReactNode;

export const InvoicesTable: React.FC<InvoicesTableProps> = ({
  invoices,
  meta,
  isLoading,
  error,
  statusFilter,
  onStatusFilterChange,
  pageSize,
  onPageChange,
}) => {
  const columns = [
    { key: "date", header: "Date", render: passthrough },
    { key: "invoice", header: "Invoice", render: passthrough },
    { key: "plan", header: "Plan", render: passthrough },
    { key: "amountDue", header: "Amount Due", render: passthrough },
    { key: "amountPaid", header: "Amount Paid", render: passthrough },
    { key: "status", header: "Status", render: passthrough },
    { key: "link", header: "Link", render: passthrough },
  ];

  return (
    <Card className="border-border">
      <CardHeader
        title="Invoices"
        subtitle="Billing history for your subscription."
        action={
          <div className="w-48">
            <Select
              value={statusFilter}
              onChange={onStatusFilterChange}
              options={[
                { value: "", label: "All Statuses" },
                { value: "Draft", label: "Draft" },
                { value: "Open", label: "Open" },
                { value: "Paid", label: "Paid" },
                { value: "Uncollectible", label: "Uncollectible" },
                { value: "Void", label: "Void" },
              ]}
            />
          </div>
        }
      />
      <CardContent className="p-0">
        {error && (
          <div className="p-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {isLoading ? (
          <div className="p-4">
            <TableSkeleton cols={columns.length} rows={5} />
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No invoices found</p>
            <p className="text-sm">
              Invoices will appear here once billing activity begins.
            </p>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              data={invoices.map((invoice) => ({
                date: new Date(invoice.createdAt).toLocaleDateString(),
                invoice: (
                  <span className="font-mono text-xs">
                    {shortId(invoice.stripeInvoiceId || invoice.id)}
                  </span>
                ),
                plan: capitalize(invoice.subscription?.planId || ""),
                amountDue: (
                  <span className="font-semibold">
                    {formatAmount(invoice.currency, invoice.amountDue)}
                  </span>
                ),
                amountPaid: formatAmount(invoice.currency, invoice.amountPaid),
                status: getStatusBadge(invoice.status),
                link: invoice.invoiceUrl ? (
                  <a
                    href={invoice.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
              }))}
            />
            <Pagination
              currentPage={meta.page}
              totalPages={Math.max(meta.totalPages, 1)}
              totalItems={meta.total}
              pageSize={pageSize}
              onPageChange={onPageChange}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default InvoicesTable;

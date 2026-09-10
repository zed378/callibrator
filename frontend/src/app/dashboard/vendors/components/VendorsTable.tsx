// src/app/dashboard/vendors/components/VendorsTable.tsx
import React from "react";
import { Vendor } from "@/api/services/vendor.service";
import {
  Card,
  CardContent,
  TableSkeleton,
  Table,
  Badge,
  Button,
  Pagination,
} from "@/components/ui";
import { Building2, Edit, Trash2, CheckCircle2, Ban } from "lucide-react";
import { PaginatedResponse } from "@/types";

interface VendorsTableProps {
  vendors: PaginatedResponse<Vendor> | null;
  isVendorsLoading: boolean;
  pageSize: number;
  setCurrentPage: (page: number) => void;
  hasWriteAccess: boolean;
  openEditModal: (vendor: Vendor) => void;
  handleDeleteClick: (id: string) => void;
  handleQualify: (vendorId: string, approvalStatus: string) => void;
}

const approvalBadge = (status?: string | null) => {
  const s = (status || "pending").toLowerCase();
  if (s === "approved") return <Badge variant="success">Approved</Badge>;
  if (s === "rejected") return <Badge variant="danger">Rejected</Badge>;
  return <Badge variant="warning">Pending</Badge>;
};

const asNode = (value: unknown) => value as React.ReactNode;

export const VendorsTable: React.FC<VendorsTableProps> = ({
  vendors,
  isVendorsLoading,
  pageSize,
  setCurrentPage,
  hasWriteAccess,
  openEditModal,
  handleDeleteClick,
  handleQualify,
}) => {
  const getTypeBadge = (type: Vendor["type"]) => {
    const maps: Record<
      Vendor["type"],
      { variant: "primary" | "secondary" | "default"; label: string }
    > = {
      CalibrationLab: { variant: "primary", label: "Calibration Lab" },
      PartsSupplier: { variant: "secondary", label: "Parts Supplier" },
      Other: { variant: "default", label: "Other" },
    };
    const current = maps[type] || { variant: "default" as const, label: type };
    return <Badge variant={current.variant}>{current.label}</Badge>;
  };

  const getStatusBadge = (status: Vendor["status"]) => {
    return status === "Active" ? (
      <Badge variant="success">Active</Badge>
    ) : (
      <Badge variant="warning">Inactive</Badge>
    );
  };

  const columns = [
    { key: "name", header: "Name", render: asNode },
    { key: "type", header: "Type", render: asNode },
    { key: "contact", header: "Contact", render: asNode },
    { key: "phone", header: "Phone", render: asNode },
    { key: "rating", header: "Rating", render: asNode },
    { key: "status", header: "Status", render: asNode },
    { key: "approval", header: "Approval", render: asNode },
    { key: "actions", header: "Actions", render: asNode },
  ];

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        {isVendorsLoading ? (
          <TableSkeleton cols={columns.length} rows={5} />
        ) : !vendors || vendors.data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">No vendors found</p>
            <p className="text-sm">
              Try adjusting your filters or search terms.
            </p>
          </div>
        ) : (
          <>
            <Table
              columns={columns}
              data={vendors.data.map((vendor: Vendor) => ({
                id: vendor.id,
                name: (
                  <div className="font-semibold text-foreground">
                    {vendor.name}
                  </div>
                ),
                type: getTypeBadge(vendor.type),
                contact: (
                  <div>
                    <div className="text-foreground">
                      {vendor.contactPerson || "-"}
                    </div>
                    {vendor.email && (
                      <div className="text-xs text-muted-foreground">
                        {vendor.email}
                      </div>
                    )}
                  </div>
                ),
                phone: vendor.phone || "-",
                rating:
                  vendor.rating != null ? (
                    <span className="font-medium">{vendor.rating} / 5</span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  ),
                status: getStatusBadge(vendor.status),
                approval: approvalBadge(vendor.approvalStatus),
                actions: (
                  <div className="flex items-center gap-2">
                    {hasWriteAccess && (
                      <>
                        {vendor.approvalStatus?.toLowerCase() !== "approved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Approve vendor"
                            onClick={() => handleQualify(vendor.id, "approved")}
                            className="text-emerald-600 hover:text-emerald-600 hover:bg-muted"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                        {vendor.approvalStatus?.toLowerCase() !== "rejected" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Reject vendor"
                            onClick={() => handleQualify(vendor.id, "rejected")}
                            className="text-amber-600 hover:text-amber-600 hover:bg-muted"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(vendor)}
                          className="text-primary hover:text-primary hover:bg-muted"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(vendor.id)}
                          className="text-destructive hover:text-destructive hover:bg-muted"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ),
              }))}
            />
            <div className="p-4 border-t border-border flex justify-end">
              <Pagination
                currentPage={vendors.meta.page}
                totalPages={vendors.meta.totalPages}
                totalItems={vendors.meta.total ?? 0}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default VendorsTable;

import React from "react";
import type { Tenant } from "@/types";
import { Badge, Card, CardContent } from "@/components/ui";
import { Avatar } from "@/components/ui";
import { Button } from "@/components/ui";
import { HardDrive, Edit2, Trash2, Shield } from "lucide-react";
import { useRouter } from "next/navigation";

interface TenantCardProps {
  tenant: Tenant;
  onEdit: (tenant: Tenant) => void;
  onSsoConfig: (tenant: Tenant) => void;
  onDelete: (id: string) => void;
}

const getStatusVariant = (status: string): "success" | "danger" | "default" | "warning" => {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "INACTIVE":
      return "warning";
    case "SUSPENDED":
      return "danger";
    default:
      return "default";
  }
};

export const TenantCard: React.FC<TenantCardProps> = ({
  tenant,
  onEdit,
  onSsoConfig,
  onDelete,
}) => {
  const router = useRouter();

  return (
    <Card hover>
      <div className="p-6 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar
              src={tenant.logoBaseUrl || undefined}
              alt={tenant.name}
              fallback={tenant.name.charAt(0)}
              size="lg"
              className="rounded-lg"
            />
            <div>
              <h3 className="font-bold text-foreground text-base">
                {tenant.name}
              </h3>
              <p className="text-sm text-muted-foreground font-medium">
                {tenant.code}
              </p>
            </div>
          </div>
          <Badge variant={getStatusVariant(tenant.status)} size="sm">
            {tenant.status}
          </Badge>
        </div>
        {tenant.description && (
          <p className="text-sm text-muted-foreground mt-3 line-clamp-2">
            {tenant.description}
          </p>
        )}
      </div>
      <div className="px-6 py-3 border-t border-border flex items-center justify-between">
        <span className="text-sm text-muted-foreground font-medium">
          Max Users
        </span>
        <span className="text-sm font-bold text-foreground">
          {tenant.maxUsers}
        </span>
      </div>
      <div className="p-4 flex items-center justify-between bg-muted/50">
        <span className="text-xs text-muted-foreground font-medium">
          Created {new Date(tenant.createdAt).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/dashboard/tenants/${tenant.id}/backup`)}
            title="Manage Backups"
          >
            <HardDrive className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSsoConfig(tenant)}
            title="Configure SAML SSO"
          >
            <Shield className="h-4 w-4 text-primary" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEdit(tenant)}>
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(tenant.id)}
          >
             <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </Card>
  );
};


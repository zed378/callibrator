"use client";

import React, { useState } from "react";
import Img from "next/image";
import { useRouter } from "next/navigation";
import type { User } from "@/types";
import { Badge } from "@/components/ui";
import { Button } from "@/components/ui";
import { Edit2, Trash2, UserCog } from "lucide-react";
import { avatarImageProps } from "@/lib/uploadUrl";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

const SUPER_ADMIN_ROLES = ["SUPER_ADMIN", "SUPERADMIN"];

interface UserRowProps {
  user: User;
  showDeleteConfirm: string | null;
  onEdit: (user: User) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onCancelDelete: () => void;
  getStatusColor: (status: string) => string;
}

export const UserRow: React.FC<UserRowProps> = ({
  user,
  showDeleteConfirm,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onCancelDelete,
  getStatusColor,
}) => {
  const status = user.status ?? "ACTIVE";
  const variant = getStatusColor(status) as
    | "default"
    | "success"
    | "warning"
    | "danger";
  const [imgFailed, setImgFailed] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const router = useRouter();
  const addToast = useToastStore((s) => s.addToast);
  const currentUser = useAuthStore((s) => s.user);
  const impersonate = useAuthStore((s) => s.impersonate);

  // Super-admins can impersonate any other user (the backend re-checks this).
  const canImpersonate =
    SUPER_ADMIN_ROLES.includes(currentUser?.role?.name ?? "") &&
    currentUser?.id !== user.id;

  const handleImpersonate = async () => {
    const tenantId = user.tenantId ?? currentUser?.tenantId;
    if (!tenantId) {
      addToast({ type: "error", title: "Cannot determine user's tenant" });
      return;
    }
    setImpersonating(true);
    try {
      await impersonate(tenantId, user.id);
      addToast({
        type: "success",
        title: `Now impersonating ${user.username || user.email}`,
      });
      router.push("/dashboard");
    } catch (err) {
      addToast({
        type: "error",
        title: "Impersonation failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setImpersonating(false);
    }
  };

  return (
    <tr className="hover:bg-muted transition-colors">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-3">
          {/* shrink-0 keeps the avatar at a fixed size — without it a long
              email in this fixed-width column squeezes the circle to zero. */}
          <div className="w-10 h-10 shrink-0 rounded-full bg-linear-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold shadow-lg shadow-primary/20 overflow-hidden">
            {!imgFailed ? (
              <Img
                {...avatarImageProps(user.picture)}
                width={48}
                height={48}
                alt={user.username || "User"}
                className="w-full h-full object-cover"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <span>
                {(user.firstName || user.username || "?")
                  .charAt(0)
                  .toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.firstName || user.lastName || "-"}
            </div>
            <div className="text-sm text-muted-foreground">
              {user.email}
            </div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-medium text-foreground">
          {user.username || "-"}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-medium text-foreground">
          {user.role?.nameToShow || user.role?.name || "-"}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <Badge variant={variant} size="sm">
          {status}
        </Badge>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
        {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <div className="flex items-center justify-end gap-2">
          {canImpersonate && (
            <Button
              variant="ghost"
              size="sm"
              title={`Impersonate ${user.username || user.email}`}
              isLoading={impersonating}
              onClick={handleImpersonate}
            >
              <UserCog className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onEdit(user)}>
            <Edit2 className="h-4 w-4" />
          </Button>
          {showDeleteConfirm === user.id ? (
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => onDeleteConfirm(user.id)}
              >
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelDelete}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteRequest(user.id)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
};

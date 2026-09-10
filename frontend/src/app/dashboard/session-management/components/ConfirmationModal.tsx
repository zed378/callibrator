import React from "react";
import { Button } from "@/components/ui";
import { AlertTriangle, Trash2 } from "lucide-react";

interface RevokeModalProps {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  type: "revoke" | "delete";
}

export const ConfirmationModal: React.FC<RevokeModalProps> = ({ show, onConfirm, onCancel, type }) => {
  if (!show) return null;
  const isRevoke = type === "revoke";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl p-6 bg-card shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isRevoke ? "bg-destructive/10" : "bg-warning/10"}`}>
            {isRevoke ? <AlertTriangle className="w-5 h-5 text-destructive" /> : <Trash2 className="w-5 h-5 text-warning" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{isRevoke ? "Revoke Session" : "Delete Session"}</h3>
            <p className="text-sm text-muted-foreground">This action cannot be undone</p>
          </div>
        </div>
        <p className="mb-6 text-foreground">
          {isRevoke
            ? "Are you sure you want to revoke this session? The user will be immediately logged out."
            : "Are you sure you want to permanently delete this session? This will remove it from the database."}
        </p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>{isRevoke ? "Revoke Session" : "Delete Session"}</Button>
        </div>
      </div>
    </div>
  );
};

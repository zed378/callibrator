"use client";

import React, { useState } from "react";
import { KeyRound, ShieldOff, Copy, Check } from "lucide-react";
import type { User } from "@/types";
import { Button, ConfirmDialog, Dialog } from "@/components/ui";
import { userService } from "@/api/services/user.service";
import { useToastStore } from "@/stores/toastStore";

type Pending = "mfa" | "password" | null;

interface CredentialResetActionsProps {
  user: User;
  /** Called after a reset succeeds, so the list can refresh its flags. */
  onReset?: () => void;
}

const nameOf = (user: User) => user.username || user.email;

/**
 * A-162 — an administrator's credential resets for one user row:
 *  - "Reset MFA" (POST /users/:id/mfa/reset, A-141) — only for a user with MFA;
 *  - "Reset password" (POST /users/:id/password/reset) — a temporary
 *    password, shown ONCE in a dialog and held only in this component's
 *    state until it is closed.
 * Each asks for confirmation first and says what will happen. The backend
 * decides who may (tenant admin, same tenant, not self, not a higher role)
 * and its refusal is shown as the error toast.
 */
export const CredentialResetActions: React.FC<CredentialResetActionsProps> = ({
  user,
  onReset,
}) => {
  const addToast = useToastStore((s) => s.addToast);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fail = (title: string, err: unknown) =>
    addToast({
      type: "error",
      title,
      description: err instanceof Error ? err.message : undefined,
    });

  const confirm = async () => {
    const action = pending;
    setBusy(true);
    try {
      if (action === "mfa") {
        const result = await userService.resetMfa(user.id);
        addToast({
          type: "success",
          title: `MFA reset for ${nameOf(user)}`,
          description: `${result.sessionsRevoked} session(s) signed out. They sign in with their password and set up MFA again.`,
        });
      } else {
        const result = await userService.resetPassword(user.id);
        setTemporaryPassword(result.temporaryPassword);
        setCopied(false);
      }
      onReset?.();
    } catch (err) {
      fail(action === "mfa" ? "Could not reset MFA" : "Could not reset the password", err);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const copy = async () => {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      addToast({ type: "error", title: "Could not copy — select the password and copy it by hand" });
    }
  };

  const closeResult = () => {
    setTemporaryPassword(null);
    setCopied(false);
  };

  return (
    <>
      {user.mfaEnabled === true && (
        <Button
          variant="ghost"
          size="sm"
          title={`Reset MFA for ${nameOf(user)}`}
          aria-label={`Reset MFA for ${nameOf(user)}`}
          onClick={() => setPending("mfa")}
        >
          <ShieldOff className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        title={`Reset password for ${nameOf(user)}`}
        aria-label={`Reset password for ${nameOf(user)}`}
        onClick={() => setPending("password")}
      >
        <KeyRound className="h-4 w-4" />
      </Button>

      <ConfirmDialog
        isOpen={pending !== null}
        title={pending === "mfa" ? `Reset MFA for ${nameOf(user)}?` : `Reset the password of ${nameOf(user)}?`}
        description={
          pending === "mfa"
            ? "Their authenticator and recovery codes stop working and every session of theirs is signed out. They sign in with their password and set up MFA again. This is recorded in the audit trail."
            : "Their current password stops working and every session of theirs is signed out. You will see a temporary password once; they must change it when they sign in. Their MFA is not changed. This is recorded in the audit trail."
        }
        confirmLabel={pending === "mfa" ? "Reset MFA" : "Reset password"}
        variant="danger"
        isLoading={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />

      <Dialog
        isOpen={temporaryPassword !== null}
        onClose={closeResult}
        title="Temporary password"
        size="md"
      >
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">
            Give this to <strong className="text-foreground">{nameOf(user)}</strong> through a
            channel you trust. It is shown only now — it cannot be retrieved again. They must
            change it when they sign in.
          </p>
          <div className="flex items-center gap-2">
            <code
              data-testid="temporary-password"
              className="flex-1 select-all rounded-xl bg-muted px-4 py-2.5 font-mono text-base tracking-wider text-foreground"
            >
              {temporaryPassword}
            </code>
            <Button variant="secondary" size="sm" onClick={copy} aria-label="Copy temporary password">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={closeResult}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};

export default CredentialResetActions;

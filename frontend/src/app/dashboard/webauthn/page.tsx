// src/app/dashboard/webauthn/page.tsx
"use client";

import { deferEffect } from "@/lib/deferEffect";
import React, {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  Input,
} from "@/components/ui";
import { Fingerprint, KeyRound, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import {
  webauthnService,
  type Passkey,
  type WebauthnStatus,
} from "@/api/services/webauthn.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

/** Turn the browser's WebAuthn DOMExceptions into something a human can act on. */
const explain = (err: unknown): string => {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        return "The request was cancelled or timed out.";
      case "InvalidStateError":
        return "This authenticator is already registered to your account.";
      case "SecurityError":
        return "The page origin does not match the server's configured relying-party ID.";
      case "NotSupportedError":
        return "This authenticator does not support the required options.";
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

// WebAuthn support is a browser capability, not React state: read it through
// useSyncExternalStore so the server renders "unsupported" and the client
// corrects on hydration, with no cascading setState-in-effect.
const subscribeToNothing = () => () => {};
const getSupportSnapshot = () => webauthnService.isSupported();
const getServerSupportSnapshot = () => false;

/**
 * Passkeys — ADR-108 Amendment 1: an account may hold several (a phone, a
 * laptop, a security key), each named and removable on its own. Removing one
 * re-authenticates (A-213); that proof is also the lock-out guard for the last.
 */
export default function WebauthnPage() {
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const [status, setStatus] = useState<WebauthnStatus | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  // The passkey the remove dialog is for; null = every passkey.
  const [removing, setRemoving] = useState<Passkey | null>(null);
  // A-213: removing a passkey re-authenticates.
  const [removePassword, setRemovePassword] = useState("");
  const [removeCode, setRemoveCode] = useState("");
  const needsCode = user?.mfaEnabled === true;

  const isSupported = useSyncExternalStore(
    subscribeToNothing,
    getSupportSnapshot,
    getServerSupportSnapshot,
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const current = await webauthnService.getStatus();
      setStatus(current);
      setPasskeys(current.enabled ? await webauthnService.listPasskeys() : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load passkey status",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  const register = async () => {
    setBusy("register");
    try {
      await webauthnService.register(newName);
      setNewName("");
      addToast({ type: "success", title: "Passkey registered" });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Registration failed",
        description: explain(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      await webauthnService.authenticate();
      addToast({ type: "success", title: "Passkey verified" });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Verification failed",
        description: explain(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const openRemove = (passkey: Passkey | null) => {
    setRemoving(passkey);
    setIsRemoveOpen(true);
  };

  const closeRemove = () => {
    setIsRemoveOpen(false);
    setRemoving(null);
    setRemovePassword("");
    setRemoveCode("");
  };

  const remove = async () => {
    setBusy("remove");
    const reauth = {
      currentPassword: removePassword,
      ...(needsCode ? { code: removeCode.trim() } : {}),
    };
    try {
      if (removing) {
        await webauthnService.revokePasskey(removing.id, reauth);
      } else {
        await webauthnService.disable(reauth);
      }
      addToast({
        type: "success",
        title: removing ? `Passkey "${removing.name}" removed` : "Passkeys removed",
      });
      closeRemove();
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not remove passkey",
        description: explain(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    setBusy("rename");
    try {
      await webauthnService.renamePasskey(renaming.id, renameValue.trim());
      addToast({ type: "success", title: "Passkey renamed" });
      setRenaming(null);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not rename the passkey",
        description: explain(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const enabled = status?.enabled === true;
  const count = passkeys.length;
  // Removing this one leaves the account with none: the password is then the way in.
  const removesLast = removing === null || count <= 1;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Passkeys</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your device&apos;s biometrics or a hardware security
            key instead of a password.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {!isSupported && (
          <Alert variant="warning">
            This browser does not support WebAuthn. Use a current version of
            Chrome, Safari, Edge, or Firefox over HTTPS.
          </Alert>
        )}

        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Fingerprint className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    {user?.email ?? "Your account"}
                  </h2>
                  {isLoading ? (
                    <span className="text-sm text-muted-foreground">
                      Loading…
                    </span>
                  ) : (
                    <Badge variant={enabled ? "success" : "default"} size="sm">
                      {enabled ? `${count} ${count === 1 ? "passkey" : "passkeys"}` : "No passkey"}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {enabled
                    ? "Each device or security key you added is listed below; remove any you no longer use."
                    : "Register this device to sign in without a password."}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-border pt-4">
              <div className="w-56">
                <Input
                  label="Name for a new passkey"
                  placeholder="e.g. Work laptop"
                  maxLength={64}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <Button
                onClick={register}
                disabled={!isSupported}
                isLoading={busy === "register"}
                leftIcon={<KeyRound className="h-4 w-4" />}
              >
                {enabled ? "Add Another Passkey" : "Register This Device"}
              </Button>
              <Button
                variant="outline"
                onClick={test}
                disabled={!isSupported || !enabled}
                isLoading={busy === "test"}
                leftIcon={<ShieldCheck className="h-4 w-4" />}
              >
                Test Sign-In
              </Button>
              <Button
                variant="outline"
                onClick={() => openRemove(null)}
                disabled={!enabled}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Remove All Passkeys
              </Button>
            </div>
          </CardContent>
        </Card>

        {enabled && count > 0 && (
          <Card className="border-border">
            <CardContent className="pt-6">
              <h2 className="text-sm font-semibold mb-3">Your passkeys</h2>
              <ul className="divide-y divide-border">
                {passkeys.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {new Date(p.createdAt).toLocaleDateString()}
                        {" · "}
                        {p.lastUsedAt
                          ? `last used ${new Date(p.lastUsedAt).toLocaleString()}`
                          : "not used to sign in yet"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Rename passkey ${p.name}`}
                        leftIcon={<Pencil className="h-4 w-4" />}
                        onClick={() => {
                          setRenaming(p);
                          setRenameValue(p.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove passkey ${p.name}`}
                        leftIcon={<Trash2 className="h-4 w-4" />}
                        onClick={() => openRemove(p)}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold">How this works</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>
                The private key never leaves your device — the server only
                stores a public key.
              </li>
              <li>
                Add a passkey on each device you use (up to 10), and a hardware
                key as a spare.
              </li>
              <li>
                Losing a device means losing its passkey — keep your password
                and MFA working as a fallback.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Dialog
          isOpen={isRemoveOpen}
          onClose={closeRemove}
          title={removing ? `Remove "${removing.name}"` : "Remove All Passkeys"}
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="warning">
              {removesLast
                ? "After this you will sign in with your password. Confirm it below; you can register a new passkey at any time."
                : "This device or key will no longer sign you in. Your other passkeys keep working."}
            </Alert>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={removePassword}
              onChange={(e) => setRemovePassword(e.target.value)}
            />
            {needsCode && (
              <Input
                label="Authenticator code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={removeCode}
                onChange={(e) => setRemoveCode(e.target.value)}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeRemove}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={remove}
                isLoading={busy === "remove"}
                disabled={!removePassword || (needsCode && !removeCode.trim())}
              >
                {removing ? "Remove Passkey" : "Remove All"}
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          isOpen={renaming !== null}
          onClose={() => setRenaming(null)}
          title="Rename Passkey"
          size="sm"
        >
          <div className="p-6 space-y-4">
            <Input
              label="Passkey name"
              maxLength={64}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                onClick={saveRename}
                isLoading={busy === "rename"}
                disabled={!renameValue.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

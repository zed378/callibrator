// src/app/dashboard/webauthn/page.tsx
"use client";

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
} from "@/components/ui";
import { Fingerprint, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import {
  webauthnService,
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

export default function WebauthnPage() {
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const [status, setStatus] = useState<WebauthnStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isDisableOpen, setIsDisableOpen] = useState(false);

  const isSupported = useSyncExternalStore(
    subscribeToNothing,
    getSupportSnapshot,
    getServerSupportSnapshot,
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStatus(await webauthnService.getStatus());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load passkey status",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    setBusy("register");
    try {
      await webauthnService.register();
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

  const disable = async () => {
    setBusy("disable");
    try {
      await webauthnService.disable();
      addToast({ type: "success", title: "Passkey removed" });
      setIsDisableOpen(false);
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

  const enabled = status?.enabled === true;

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
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="rounded-full bg-primary/10 p-3">
                  <Fingerprint className="h-6 w-6 text-primary" />
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
                        {enabled ? "Passkey enrolled" : "No passkey"}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {enabled
                      ? "A passkey is registered to this account on one of your devices."
                      : "Register this device to sign in without a password."}
                  </p>
                  {enabled && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Used {status?.signCount ?? 0}{" "}
                      {status?.signCount === 1 ? "time" : "times"}
                      {status?.lastUpdatedAt
                        ? ` · last change ${new Date(status.lastUpdatedAt).toLocaleString()}`
                        : ""}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
              <Button
                onClick={register}
                disabled={!isSupported}
                isLoading={busy === "register"}
                leftIcon={<KeyRound className="h-4 w-4" />}
              >
                {enabled ? "Replace Passkey" : "Register This Device"}
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
                onClick={() => setIsDisableOpen(true)}
                disabled={!enabled}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Remove Passkey
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold">How this works</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>
                The private key never leaves your device — the server only
                stores a public key.
              </li>
              <li>
                One passkey is held per account: registering again replaces the
                existing one.
              </li>
              <li>
                Losing the device means losing this passkey — keep your password
                and MFA working as a fallback.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Dialog
          isOpen={isDisableOpen}
          onClose={() => setIsDisableOpen(false)}
          title="Remove Passkey"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="warning">
              You will need your password to sign in after this. You can
              register a new passkey at any time.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsDisableOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={disable}
                isLoading={busy === "disable"}
              >
                Remove Passkey
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

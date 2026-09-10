// src/app/dashboard/oidc/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  FormField,
  Input,
  Table,
} from "@/components/ui";
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  oidcService,
  type OidcClient,
  type OidcDiscovery,
} from "@/api/services/oidc.service";
import { useToastStore } from "@/stores/toastStore";

const SCOPES = ["openid", "profile", "email", "offline_access"];

export default function OidcPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [clients, setClients] = useState<OidcClient[]>([]);
  const [discovery, setDiscovery] = useState<OidcDiscovery | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [redirectUris, setRedirectUris] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    "openid",
    "profile",
    "email",
  ]);

  // The plaintext secret is returned exactly once — hold it until dismissed.
  const [issuedSecret, setIssuedSecret] = useState<{
    clientId: string;
    clientSecret: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OidcClient | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [list, disc] = await Promise.all([
        oidcService.getClients(),
        oidcService.getDiscovery().catch(() => null),
      ]);
      setClients(list);
      setDiscovery(disc);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load OIDC clients",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast({ type: "success", title: `${what} copied` });
    } catch {
      addToast({ type: "error", title: "Copy failed" });
    }
  };

  const resetForm = () => {
    setName("");
    setRedirectUris("");
    setSelectedScopes(["openid", "profile", "email"]);
  };

  const create = async () => {
    const uris = redirectUris
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    if (!name.trim()) {
      addToast({ type: "error", title: "Client name is required" });
      return;
    }
    if (uris.length === 0) {
      addToast({ type: "error", title: "At least one redirect URI is required" });
      return;
    }
    // The backend validates these as URIs; fail fast with a clearer message.
    const invalid = uris.find((u) => !/^https?:\/\/.+/i.test(u));
    if (invalid) {
      addToast({
        type: "error",
        title: "Invalid redirect URI",
        description: invalid,
      });
      return;
    }

    setBusy("create");
    try {
      const res = await oidcService.registerClient({
        name: name.trim(),
        redirectUris: uris,
        scopes: selectedScopes,
      });
      setIsCreateOpen(false);
      resetForm();
      setIssuedSecret({
        clientId: res.clientId,
        clientSecret: res.clientSecret,
      });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Registration failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const rotate = async (client: OidcClient) => {
    setBusy(client.clientId);
    try {
      const res = await oidcService.rotateSecret(client.clientId);
      setIssuedSecret({
        clientId: res.clientId,
        clientSecret: res.clientSecret,
      });
      addToast({ type: "success", title: "Secret rotated" });
    } catch (err) {
      addToast({
        type: "error",
        title: "Rotation failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy("delete");
    try {
      await oidcService.deleteClient(confirmDelete.clientId);
      addToast({ type: "success", title: "Client deleted" });
      setConfirmDelete(null);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Delete failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Client",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div>
          <div className="font-medium">{String(value ?? "—")}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {String(row.clientId ?? "")}
          </div>
        </div>
      ),
    },
    {
      key: "redirectUris",
      header: "Redirect URIs",
      render: (value: unknown) => {
        const uris = Array.isArray(value) ? (value as string[]) : [];
        return uris.length ? (
          <div className="space-y-0.5">
            {uris.map((u) => (
              <div key={u} className="font-mono text-xs">
                {u}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "scopes",
      header: "Scopes",
      render: (value: unknown) => {
        const scopes = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="flex flex-wrap gap-1">
            {scopes.map((s) => (
              <Badge key={s} variant="secondary" size="sm">
                {s}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (_value: unknown, r: Record<string, unknown>) => {
        const client = r as unknown as OidcClient;
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              isLoading={busy === client.clientId}
              onClick={() => rotate(client)}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Rotate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(client)}
              aria-label={`Delete ${client.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">OIDC Provider</h1>
            <p className="text-sm text-muted-foreground">
              Register applications that sign users in with this platform as
              their identity provider.
            </p>
          </div>
          <Button
            onClick={() => setIsCreateOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Register Client
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {discovery && (
          <Card className="bg-card/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6 space-y-3">
              <h2 className="text-sm font-semibold">Endpoints</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {[
                  ["Issuer", discovery.issuer],
                  ["Authorization", discovery.authorization_endpoint],
                  ["Token", discovery.token_endpoint],
                  ["UserInfo", discovery.userinfo_endpoint],
                  ["JWKS", discovery.jwks_uri],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-muted-foreground">{label}</p>
                    <div className="flex items-center gap-1">
                      <code className="truncate text-xs">{value}</code>
                      <button
                        type="button"
                        onClick={() => copy(String(value), label)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Copy ${label}`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Signing algorithm:{" "}
                {discovery.id_token_signing_alg_values_supported?.join(", ")}
              </p>
            </CardContent>
          </Card>
        )}

        <Table
          columns={columns}
          data={clients as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No OIDC clients registered yet."
        />

        {/* Register */}
        <Dialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Register OIDC Client"
          size="lg"
        >
          <div className="p-6 space-y-4">
            <FormField label="Client name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Partner Portal"
              />
            </FormField>

            <FormField
              label="Redirect URIs"
              required
              helperText="One per line. Must be absolute http(s) URLs."
            >
              <textarea
                rows={3}
                value={redirectUris}
                onChange={(e) => setRedirectUris(e.target.value)}
                placeholder={"https://app.example.com/callback"}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              />
            </FormField>

            <FormField label="Scopes">
              <div className="flex flex-wrap gap-2">
                {SCOPES.map((scope) => {
                  const active = selectedScopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() =>
                        setSelectedScopes(
                          active
                            ? selectedScopes.filter((s) => s !== scope)
                            : [...selectedScopes, scope],
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {scope}
                    </button>
                  );
                })}
              </div>
            </FormField>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} isLoading={busy === "create"}>
                Register
              </Button>
            </div>
          </div>
        </Dialog>

        {/* One-time secret reveal */}
        <Dialog
          isOpen={issuedSecret !== null}
          onClose={() => setIssuedSecret(null)}
          title="Client Secret"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="warning">
              Copy this secret now — it is stored hashed and cannot be shown
              again. Rotating is the only way to issue a new one.
            </Alert>
            <div>
              <p className="text-sm text-muted-foreground">Client ID</p>
              <code className="block break-all text-sm">
                {issuedSecret?.clientId}
              </code>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Client Secret</p>
              <div className="flex items-start gap-2">
                <code className="block flex-1 break-all rounded-md bg-muted p-2 text-sm">
                  {issuedSecret?.clientSecret}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    copy(issuedSecret?.clientSecret ?? "", "Secret")
                  }
                  leftIcon={<KeyRound className="h-4 w-4" />}
                >
                  Copy
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setIssuedSecret(null)}>
                I&apos;ve saved it
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Delete confirm */}
        <Dialog
          isOpen={confirmDelete !== null}
          onClose={() => setConfirmDelete(null)}
          title="Delete OIDC Client"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              Applications using{" "}
              <span className="font-medium">{confirmDelete?.name}</span> will
              stop being able to sign users in immediately.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={remove}
                isLoading={busy === "delete"}
              >
                Delete Client
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

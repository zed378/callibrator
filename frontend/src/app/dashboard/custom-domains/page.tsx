// src/app/dashboard/custom-domains/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Table,
} from "@/components/ui";
import { BadgeCheck, Copy, Globe, Plus, Star, Trash2 } from "lucide-react";
import {
  customDomainService,
  type CustomDomain,
  type DnsRecord,
  type DomainType,
} from "@/api/services/customDomain.service";
import { useToastStore } from "@/stores/toastStore";

const TYPES: DomainType[] = ["subdomain", "custom", "vanity"];

// Mirrors the backend's Joi hostname check closely enough to fail fast.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*)(\.[a-z0-9](-?[a-z0-9])*)+$/i;

const statusVariant = (s?: string): "default" | "success" | "warning" => {
  const v = (s || "").toLowerCase();
  if (v.includes("verif") && !v.includes("un")) return "success";
  if (v.includes("pend")) return "warning";
  return "default";
};

export default function CustomDomainsPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState({
    domain: "",
    type: "subdomain" as DomainType,
    sslEnabled: true,
  });

  const [dnsFor, setDnsFor] = useState<CustomDomain | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<CustomDomain | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setDomains(await customDomainService.getAll());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load domains");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, title: string) => {
    setBusy(key);
    try {
      await fn();
      addToast({ type: "success", title });
      await load();
      return true;
    } catch (err) {
      addToast({
        type: "error",
        title: "Action failed",
        description: err instanceof Error ? err.message : undefined,
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const domain = form.domain.trim().toLowerCase();
    if (!HOSTNAME_RE.test(domain)) {
      addToast({
        type: "error",
        title: "Invalid hostname",
        description: "Use a bare hostname like clinic.example.com — no scheme or path.",
      });
      return;
    }
    const ok = await run(
      "add",
      () =>
        customDomainService.create({
          domain,
          type: form.type,
          sslEnabled: form.sslEnabled,
        }),
      "Domain added — add the DNS records to verify it",
    );
    if (ok) {
      setIsAddOpen(false);
      setForm({ domain: "", type: "subdomain", sslEnabled: true });
    }
  };

  const openDns = async (domain: CustomDomain) => {
    setDnsFor(domain);
    setDnsRecords([]);
    try {
      setDnsRecords(await customDomainService.getDnsRecords(domain.id));
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not load DNS records",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast({ type: "success", title: "Copied" });
    } catch {
      addToast({ type: "error", title: "Copy failed" });
    }
  };

  const columns = [
    {
      key: "domain",
      header: "Domain",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">{String(value ?? "")}</div>
            <div className="text-xs text-muted-foreground">
              {String(row.type ?? "")}
              {row.sslEnabled === false ? " · SSL off" : " · SSL on"}
            </div>
          </div>
          {row.isDefault ? (
            <Badge variant="primary" size="sm">
              default
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={statusVariant(value as string)} size="sm">
          {String(value ?? "pending")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const d = r as unknown as CustomDomain;
        return (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => openDns(d)}>
              DNS
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isLoading={busy === `verify-${d.id}`}
              onClick={() =>
                run(
                  `verify-${d.id}`,
                  () => customDomainService.verify(d.id),
                  "Verification started",
                )
              }
              leftIcon={<BadgeCheck className="h-4 w-4" />}
            >
              Verify
            </Button>
            {!d.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                isLoading={busy === `default-${d.id}`}
                onClick={() =>
                  run(
                    `default-${d.id}`,
                    () => customDomainService.setAsDefault(d.id),
                    "Default domain set",
                  )
                }
                leftIcon={<Star className="h-4 w-4" />}
              >
                Make default
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(d)}
              aria-label={`Remove ${d.domain}`}
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
            <h1 className="text-2xl font-bold tracking-tight">Custom Domains</h1>
            <p className="text-sm text-muted-foreground">
              Serve the platform on your own hostname. Add the DNS records, then
              verify.
            </p>
          </div>
          <Button
            onClick={() => setIsAddOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Add Domain
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Table
          columns={columns}
          data={domains as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No custom domains configured."
        />

        <Alert variant="info">
          A domain cannot be edited after it is added — remove it and add the
          corrected hostname instead.
        </Alert>

        {/* Add */}
        <Dialog
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          title="Add Custom Domain"
          size="md"
        >
          <div className="p-6 space-y-4">
            <FormField
              label="Hostname"
              required
              helperText="Bare hostname only — no https:// and no trailing path."
            >
              <Input
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="clinic.example.com"
                className="font-mono text-sm"
              />
            </FormField>
            <FormField label="Type">
              <Select
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v as DomainType })}
                options={TYPES.map((t) => ({ value: t, label: t }))}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.sslEnabled}
                onChange={(e) =>
                  setForm({ ...form, sslEnabled: e.target.checked })
                }
              />
              Provision SSL for this domain
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button onClick={add} isLoading={busy === "add"}>
                Add Domain
              </Button>
            </div>
          </div>
        </Dialog>

        {/* DNS */}
        <Dialog
          isOpen={dnsFor !== null}
          onClose={() => setDnsFor(null)}
          title={`DNS records — ${dnsFor?.domain ?? ""}`}
          size="lg"
        >
          <div className="p-6 space-y-4">
            <Alert variant="info">
              Add these at your DNS provider, then use Verify. Propagation can
              take up to 48 hours.
            </Alert>
            {dnsRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No records returned.
              </p>
            ) : (
              <div className="space-y-2">
                {dnsRecords.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border p-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" size="sm">
                        {r.type}
                      </Badge>
                      {r.ttl ? (
                        <span className="text-xs text-muted-foreground">
                          TTL {r.ttl}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Name</p>
                        <div className="flex items-center gap-1">
                          <code className="truncate text-xs">{r.name}</code>
                          <button
                            type="button"
                            onClick={() => copy(r.name)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Copy name"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Value</p>
                        <div className="flex items-center gap-1">
                          <code className="truncate text-xs">{r.value}</code>
                          <button
                            type="button"
                            onClick={() => copy(r.value)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Copy value"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setDnsFor(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Delete */}
        <Dialog
          isOpen={confirmDelete !== null}
          onClose={() => setConfirmDelete(null)}
          title="Remove Domain"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              <span className="font-mono">{confirmDelete?.domain}</span> will
              stop serving the platform immediately.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                isLoading={busy === "delete"}
                onClick={async () => {
                  if (!confirmDelete) return;
                  const ok = await run(
                    "delete",
                    () => customDomainService.delete(confirmDelete.id),
                    "Domain removed",
                  );
                  if (ok) setConfirmDelete(null);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// src/app/dashboard/storage/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Input,
  Select,
  FormField,
  Alert,
  Badge,
  Skeleton,
} from "@/components/ui";
import { Database, HardDrive, Cloud, RefreshCw, Save, PlugZap } from "lucide-react";
import { useStorageSettings } from "./hooks/useStorageSettings";
import { UpdateStorageInput } from "@/api/services/storage.service";

const PROVIDER_OPTIONS = [
  { value: "s3", label: "S3-compatible (AWS S3, MinIO, R2, Wasabi)" },
  { value: "nfs", label: "NFS mount" },
];

/** Human-readable MB with one decimal. */
const fmtMb = (mb: number) => `${mb.toFixed(1)} MB`;

export default function StoragePage() {
  const { settings, usage, isLoading, isSaving, isTesting, save, reset, test } =
    useStorageSettings();

  const [provider, setProvider] = useState<"s3" | "nfs">("s3");
  const [form, setForm] = useState<UpdateStorageInput>({ provider: "s3" });
  const seededRef = useRef(false);

  // Seed the form from the loaded settings once (non-secret fields only; the
  // API never returns credentials, so those start blank). The state writes are
  // deferred out of the synchronous effect body to avoid the cascading-render
  // lint (React Compiler / set-state-in-effect).
  useEffect(() => {
    if (seededRef.current || !settings || settings.usingPlatformDefault) return;
    if (settings.provider !== "s3" && settings.provider !== "nfs") return;
    seededRef.current = true;
    const s = settings;
    queueMicrotask(() => {
      setProvider(s.provider as "s3" | "nfs");
      setForm({
        provider: s.provider as "s3" | "nfs",
        bucket: s.bucket,
        region: s.region,
        endpoint: s.endpoint ?? undefined,
        forcePathStyle: s.forcePathStyle,
        prefix: s.prefix ?? undefined,
        root: s.root,
        fsync: s.fsync,
      });
    });
  }, [settings]);

  const setField = (patch: Partial<UpdateStorageInput>) =>
    setForm((f) => ({ ...f, ...patch }));

  const changeProvider = (value: string) => {
    const p = value as "s3" | "nfs";
    setProvider(p);
    setForm({ provider: p });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await save({ ...form, provider });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <Database className="h-6 w-6 text-primary" />
              Storage
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bring your own object storage so your files live in a bucket you
              own — or use the platform default.
            </p>
          </div>
          <Button variant="outline" onClick={test} isLoading={isTesting}>
            <PlugZap className="mr-2 h-4 w-4" /> Test connection
          </Button>
        </div>

        {/* Usage + current provider */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-4 py-5">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <HardDrive className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Stored
                </p>
                {isLoading ? (
                  <Skeleton className="mt-1 h-6 w-24" />
                ) : (
                  <p className="text-xl font-bold text-foreground">
                    {usage ? fmtMb(usage.megabytes) : "—"}
                    {usage && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {usage.objects} object{usage.objects === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 py-5">
              <div className="rounded-xl bg-accent/10 p-3 text-accent">
                <Cloud className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Active provider
                </p>
                {isLoading ? (
                  <Skeleton className="mt-1 h-6 w-32" />
                ) : (
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge>
                      {settings?.usingPlatformDefault
                        ? "Platform default"
                        : (settings?.provider ?? "—").toUpperCase()}
                    </Badge>
                    {settings?.bucket && (
                      <span className="truncate text-sm text-muted-foreground">
                        {settings.bucket}
                      </span>
                    )}
                    {settings?.root && (
                      <span className="truncate text-sm text-muted-foreground">
                        {settings.root}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Configuration form */}
        <Card>
          <CardHeader
            title="Configure your own storage"
            subtitle="We verify the connection before saving. Credentials are stored encrypted and never shown again."
          />

          <form onSubmit={handleSave}>
            <CardContent className="space-y-4">
              <FormField label="Provider" required>
                <Select
                  value={provider}
                  onChange={changeProvider}
                  options={PROVIDER_OPTIONS}
                />
              </FormField>

              {provider === "s3" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Bucket" required>
                    <Input
                      value={form.bucket ?? ""}
                      onChange={(e) => setField({ bucket: e.target.value })}
                      placeholder="my-tenant-bucket"
                    />
                  </FormField>
                  <FormField label="Region">
                    <Input
                      value={form.region ?? ""}
                      onChange={(e) => setField({ region: e.target.value })}
                      placeholder="ap-southeast-1"
                    />
                  </FormField>
                  <FormField
                    label="Endpoint"
                    helperText="For non-AWS (MinIO/R2/Wasabi). Leave blank for AWS."
                  >
                    <Input
                      value={form.endpoint ?? ""}
                      onChange={(e) => setField({ endpoint: e.target.value })}
                      placeholder="https://s3.example.com"
                    />
                  </FormField>
                  <FormField label="Path prefix">
                    <Input
                      value={form.prefix ?? ""}
                      onChange={(e) => setField({ prefix: e.target.value })}
                      placeholder="prod"
                    />
                  </FormField>
                  <FormField
                    label="Access key ID"
                    helperText="Leave blank to keep the existing credentials."
                  >
                    <Input
                      value={form.accessKeyId ?? ""}
                      onChange={(e) => setField({ accessKeyId: e.target.value })}
                      placeholder="AKIA…"
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField label="Secret access key">
                    <Input
                      type="password"
                      value={form.secretAccessKey ?? ""}
                      onChange={(e) =>
                        setField({ secretAccessKey: e.target.value })
                      }
                      placeholder="••••••••"
                      autoComplete="off"
                    />
                  </FormField>
                </div>
              ) : (
                <FormField
                  label="Mount root"
                  required
                  helperText="An absolute path to a mounted NFS export on the server."
                >
                  <Input
                    value={form.root ?? ""}
                    onChange={(e) => setField({ root: e.target.value })}
                    placeholder="/mnt/callibrator"
                  />
                </FormField>
              )}

              <Alert>
                Switching providers does not copy existing files. Migrate
                objects to the new backend before making it the source of truth.
              </Alert>
            </CardContent>

            <CardFooter className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={reset}
                disabled={isSaving || settings?.usingPlatformDefault}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Reset to platform default
              </Button>
              <Button type="submit" isLoading={isSaving}>
                <Save className="mr-2 h-4 w-4" /> Verify & save
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </DashboardLayout>
  );
}

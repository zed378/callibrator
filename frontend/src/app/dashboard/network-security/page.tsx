// src/app/dashboard/network-security/page.tsx
"use client";

import { deferEffect } from "@/lib/deferEffect";
import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  FormField,
  Input,
} from "@/components/ui";
import { MapPin, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import {
  networkSecurityService,
  type Geofence,
  type LoginEvaluation,
} from "@/api/services/networkSecurity.service";
import { useToastStore } from "@/stores/toastStore";
import { usePermissions } from "@/hooks/usePermissions";

// A first check only; the server validates and normalises every entry
// (validators/networkSecurity.validator.ts, ADR-100): an IPv4 or IPv6 address,
// with or without a prefix.
const CIDR_RE =
  /^(?:(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?|[0-9a-fA-F:.]*:[0-9a-fA-F:.]*(\/\d{1,3})?)$/;

/**
 * F-19: every change to the allowlist is confirmed first. Adding a range can
 * lock the caller out (only listed ranges may sign in), removing one can lock
 * out whoever signs in from it, and removing all lifts the restriction.
 */
type PendingChange =
  | { kind: "add"; cidr: string }
  | { kind: "remove"; cidr: string }
  | { kind: "removeAll" };

export default function NetworkSecurityPage() {
  const addToast = useToastStore((s) => s.addToast);
  // ADR-102: the write controls follow the effective permission the PUTs are
  // gated on (`network-security: write`; a tenant administrator since Q-38,
  // ADR-100). Absent until the permissions load, and absent without it.
  const { canWrite } = usePermissions();
  const mayWrite = canWrite("network-security");

  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newCidr, setNewCidr] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("");

  const [testIp, setTestIp] = useState("");
  const [testLat, setTestLat] = useState("");
  const [testLng, setTestLng] = useState("");
  // Each check read flat: either variant, a field it lacks reading undefined.
  // A-357: `distanceKm` is null when a geofence is set and the dry run names
  // no location (checkGeofence computes NaN, fails closed, and JSON writes it
  // as null) — it is read as nullable and never handed to `.toFixed`.
  type EvaluationView = Omit<LoginEvaluation, "ip" | "geofence"> & {
    ip?: { allowed: boolean; reason?: string };
    geofence?: { allowed: boolean; reason?: string; distanceKm?: number | null; radiusKm?: number };
  };
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [list, fence] = await Promise.all([
        networkSecurityService.getIpAllowlist(),
        networkSecurityService.getGeofence(),
      ]);
      setAllowlist(list);
      setGeofence(fence);
      setLat(fence ? String(fence.latitude) : "");
      setLng(fence ? String(fence.longitude) : "");
      setRadius(fence ? String(fence.radiusKm) : "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load network settings",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  /** The allowlist is replace-only server-side, so add/remove both PUT the full list. */
  const persistAllowlist = async (next: string[], title: string) => {
    setBusy("allowlist");
    try {
      await networkSecurityService.setIpAllowlist(next);
      setAllowlist(next);
      addToast({ type: "success", title });
    } catch (err) {
      addToast({
        type: "error",
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  /** Validate the typed range, then ask before it is added (F-19). */
  const addCidr = () => {
    const cidr = newCidr.trim();
    if (!CIDR_RE.test(cidr)) {
      addToast({
        type: "error",
        title: "Invalid CIDR",
        description:
          "Use a form like 203.0.113.0/24, 203.0.113.7 or 2001:db8::/32",
      });
      return;
    }
    if (allowlist.includes(cidr)) {
      addToast({ type: "error", title: "That range is already listed" });
      return;
    }
    setPending({ kind: "add", cidr });
  };

  const removeCidr = (cidr: string) => setPending({ kind: "remove", cidr });

  const confirmPending = async () => {
    const change = pending;
    if (!change) return;
    setPending(null);
    if (change.kind === "add") {
      await persistAllowlist([...allowlist, change.cidr], "Range added");
      setNewCidr("");
    } else if (change.kind === "remove") {
      await persistAllowlist(
        allowlist.filter((c) => c !== change.cidr),
        "Range removed",
      );
    } else {
      await persistAllowlist([], "All IP restrictions removed");
    }
  };

  const confirmCopy = (change: PendingChange) => {
    if (change.kind === "add") {
      return {
        title: `Add ${change.cidr} to the allowlist?`,
        description:
          allowlist.length === 0
            ? "This turns the allowlist on: from now on only this range may sign in to this tenant. If you are not browsing from it, you will be locked out."
            : "Sign-in will be allowed from this range as well as the ones already listed.",
        confirmLabel: "Add range",
      };
    }
    if (change.kind === "remove") {
      return {
        title: `Remove ${change.cidr}?`,
        description:
          allowlist.length === 1
            ? "This is the last range: removing it lifts the IP restriction, and sign-in is allowed from any IP."
            : "Nobody will be able to sign in from this range any more — including you, if you are browsing from it.",
        confirmLabel: "Remove range",
      };
    }
    return {
      title: "Remove all IP restrictions?",
      description: `All ${allowlist.length} ranges are removed, and sign-in is allowed from any IP address.`,
      confirmLabel: "Remove all",
    };
  };

  /** This device's position, or null when it is unavailable or refused (10 s timeout). */
  const readCurrentPosition = (): Promise<{
    latitude: number;
    longitude: number;
  } | null> =>
    new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      );
    });

  const saveGeofence = async () => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!lat || !lng || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      addToast({ type: "error", title: "Latitude and longitude are required" });
      return;
    }
    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      addToast({ type: "error", title: "Coordinates are out of range" });
      return;
    }
    const radiusKm = radius ? Number(radius) : undefined;
    if (radiusKm !== undefined && (Number.isNaN(radiusKm) || radiusKm <= 0)) {
      addToast({ type: "error", title: "Radius must be a positive number" });
      return;
    }
    setBusy("geofence");
    try {
      // Q-38 (ADR-100): the server refuses (409) a geofence that would lock
      // out the person saving it, and needs this device's position to check.
      // The browser asks for consent; without a position the save is still
      // sent (a platform operator is exempt) and the server explains a refusal.
      const currentLocation = await readCurrentPosition();
      if (!currentLocation) {
        addToast({
          type: "info",
          title: "Your location was not shared",
          description:
            "The server checks that a new geofence still includes you. Without your location, it may refuse to save. Allow location access in your browser and try again.",
        });
      }
      const res = await networkSecurityService.setGeofence(
        latitude,
        longitude,
        radiusKm,
        currentLocation ?? undefined,
      );
      setGeofence(res.geofence);
      setRadius(String(res.geofence?.radiusKm ?? ""));
      addToast({ type: "success", title: "Geofence saved" });
    } catch (err) {
      addToast({
        type: "error",
        title: "Save failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      addToast({ type: "error", title: "Geolocation is unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
      },
      () => addToast({ type: "error", title: "Could not read your location" }),
    );
  };

  const evaluate = async () => {
    if (!testIp.trim()) {
      addToast({ type: "error", title: "Enter an IP address to test" });
      return;
    }
    setBusy("evaluate");
    setEvaluation(null);
    try {
      const res = await networkSecurityService.evaluateLogin(
        testIp.trim(),
        testLat ? Number(testLat) : undefined,
        testLng ? Number(testLng) : undefined,
      );
      setEvaluation(res as EvaluationView);
    } catch (err) {
      addToast({
        type: "error",
        title: "Evaluation failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Network Security
          </h1>
          <p className="text-sm text-muted-foreground">
            Restrict where your tenant can be signed into, by IP range and by
            physical location.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {/* IP allowlist */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">IP Allowlist</h2>
                <p className="text-sm text-muted-foreground">
                  Only these ranges may sign in. An empty list means no IP
                  restriction.
                </p>
              </div>
              <Badge
                variant={allowlist.length ? "success" : "default"}
                size="sm"
              >
                {allowlist.length ? "Enforced" : "Unrestricted"}
              </Badge>
            </div>

            {mayWrite && allowlist.length > 0 && (
              <Alert variant="warning">
                Adding a range you are not currently browsing from can lock you
                out of this tenant.
              </Alert>
            )}

            {mayWrite && (
              <div className="flex gap-2">
                <Input
                  value={newCidr}
                  onChange={(e) => setNewCidr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCidr();
                  }}
                  placeholder="203.0.113.0/24"
                  aria-label="IP range (CIDR)"
                  className="flex-1"
                />
                <Button
                  onClick={addCidr}
                  isLoading={busy === "allowlist"}
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  Add
                </Button>
              </div>
            )}

            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : allowlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No ranges configured — sign-in is allowed from any IP.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {allowlist.map((cidr) => (
                  <li
                    key={cidr}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="font-mono text-sm">{cidr}</span>
                    {mayWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeCidr(cidr)}
                        aria-label={`Remove ${cidr}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {mayWrite && allowlist.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPending({ kind: "removeAll" })}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Remove all restrictions
              </Button>
            )}
          </CardContent>
        </Card>

        {pending && (
          <ConfirmDialog
            isOpen
            {...confirmCopy(pending)}
            variant={pending.kind === "add" ? "primary" : "danger"}
            onConfirm={() => void confirmPending()}
            onCancel={() => setPending(null)}
          />
        )}

        {/* Geofence */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Geofence</h2>
                <p className="text-sm text-muted-foreground">
                  Sign-in must originate within this radius of the anchor point.
                </p>
              </div>
              <Badge variant={geofence ? "success" : "default"} size="sm">
                {geofence ? "Configured" : "Not set"}
              </Badge>
            </div>

            {!mayWrite && (
              <p className="text-sm text-muted-foreground">
                {geofence
                  ? `Anchor ${geofence.latitude}, ${geofence.longitude} — radius ${geofence.radiusKm} km.`
                  : "No geofence is configured."}
              </p>
            )}

            {mayWrite && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <FormField label="Latitude">
                    <Input
                      type="number"
                      step="any"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="-6.200000"
                    />
                  </FormField>
                  <FormField label="Longitude">
                    <Input
                      type="number"
                      step="any"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      placeholder="106.816666"
                    />
                  </FormField>
                  <FormField
                    label="Radius (km)"
                    helperText="Defaults to 50 km."
                  >
                    <Input
                      type="number"
                      min={1}
                      value={radius}
                      onChange={(e) => setRadius(e.target.value)}
                      placeholder="50"
                    />
                  </FormField>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={saveGeofence}
                    isLoading={busy === "geofence"}
                    leftIcon={<ShieldCheck className="h-4 w-4" />}
                  >
                    Save Geofence
                  </Button>
                  <Button
                    variant="outline"
                    onClick={useMyLocation}
                    leftIcon={<MapPin className="h-4 w-4" />}
                  >
                    Use My Location
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Dry-run evaluator */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Test a Sign-In</h2>
              <p className="text-sm text-muted-foreground">
                Dry-run both checks against a candidate IP and location. Nothing
                is changed.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="IP address" required>
                <Input
                  value={testIp}
                  onChange={(e) => setTestIp(e.target.value)}
                  placeholder="203.0.113.9"
                />
              </FormField>
              <FormField label="Latitude" helperText="Optional">
                <Input
                  type="number"
                  step="any"
                  value={testLat}
                  onChange={(e) => setTestLat(e.target.value)}
                />
              </FormField>
              <FormField label="Longitude" helperText="Optional">
                <Input
                  type="number"
                  step="any"
                  value={testLng}
                  onChange={(e) => setTestLng(e.target.value)}
                />
              </FormField>
            </div>

            <Button
              variant="outline"
              onClick={evaluate}
              isLoading={busy === "evaluate"}
            >
              Evaluate
            </Button>

            {evaluation && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <div className="flex items-center gap-2">
                  <Badge variant={evaluation.allowed ? "success" : "danger"}>
                    {evaluation.allowed ? "Allowed" : "Blocked"}
                  </Badge>
                  {evaluation.requiresStepUp && (
                    <Badge variant="warning" size="sm">
                      step-up required
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">IP check</p>
                    <p className="font-medium">
                      {evaluation.ip?.allowed ? "Pass" : "Fail"}
                      {evaluation.ip?.reason
                        ? ` (${evaluation.ip.reason})`
                        : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Geofence check</p>
                    <p className="font-medium">
                      {evaluation.geofence?.allowed ? "Pass" : "Fail"}
                      {evaluation.geofence?.reason
                        ? ` (${evaluation.geofence.reason})`
                        : typeof evaluation.geofence?.distanceKm === "number"
                          ? ` — ${evaluation.geofence.distanceKm.toFixed(1)} km from anchor, limit ${evaluation.geofence.radiusKm} km`
                          : evaluation.geofence?.radiusKm !== undefined
                            ? ` — no location given, limit ${evaluation.geofence.radiusKm} km`
                            : ""}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

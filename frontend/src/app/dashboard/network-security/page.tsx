// src/app/dashboard/network-security/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
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

// Mirrors the backend Joi pattern: dotted quad with an optional prefix.
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

export default function NetworkSecurityPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newCidr, setNewCidr] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("");

  const [testIp, setTestIp] = useState("");
  const [testLat, setTestLat] = useState("");
  const [testLng, setTestLng] = useState("");
  const [evaluation, setEvaluation] = useState<LoginEvaluation | null>(null);

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

  useEffect(() => {
    void load();
  }, [load]);

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

  const addCidr = async () => {
    const cidr = newCidr.trim();
    if (!CIDR_RE.test(cidr)) {
      addToast({
        type: "error",
        title: "Invalid CIDR",
        description: "Use a form like 203.0.113.0/24 or 203.0.113.7",
      });
      return;
    }
    if (allowlist.includes(cidr)) {
      addToast({ type: "error", title: "That range is already listed" });
      return;
    }
    await persistAllowlist([...allowlist, cidr], "Range added");
    setNewCidr("");
  };

  const removeCidr = (cidr: string) =>
    persistAllowlist(
      allowlist.filter((c) => c !== cidr),
      "Range removed",
    );

  const saveGeofence = async () => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!lat || !lng || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      addToast({ type: "error", title: "Latitude and longitude are required" });
      return;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
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
      const res = await networkSecurityService.setGeofence(
        latitude,
        longitude,
        radiusKm,
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
      setEvaluation(res);
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

            {allowlist.length > 0 && (
              <Alert variant="warning">
                Adding a range you are not currently browsing from can lock you
                out of this tenant.
              </Alert>
            )}

            <div className="flex gap-2">
              <Input
                value={newCidr}
                onChange={(e) => setNewCidr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addCidr();
                }}
                placeholder="203.0.113.0/24"
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeCidr(cidr)}
                      aria-label={`Remove ${cidr}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {allowlist.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => persistAllowlist([], "All IP restrictions removed")}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Remove all restrictions
              </Button>
            )}
          </CardContent>
        </Card>

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
              <FormField label="Radius (km)" helperText="Defaults to 50 km.">
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
                      {evaluation.ip?.reason ? ` (${evaluation.ip.reason})` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Geofence check</p>
                    <p className="font-medium">
                      {evaluation.geofence?.allowed ? "Pass" : "Fail"}
                      {evaluation.geofence?.reason
                        ? ` (${evaluation.geofence.reason})`
                        : evaluation.geofence?.distanceKm !== undefined
                          ? ` — ${evaluation.geofence.distanceKm.toFixed(1)} km from anchor, limit ${evaluation.geofence.radiusKm} km`
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

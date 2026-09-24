// src/app/dashboard/devices/components/IotDeviceModal.tsx
//
// A-29 / A-46 — provision a device for IoT ingest: issue, rotate or revoke its
// ingest token (shown ONCE, then only "a token exists"), enable/disable
// ingest, and set the reading tolerance that drives anomaly detection.
// Mount it with `key={device.id}` so each device starts from fresh state.
"use client";

import React, { useEffect, useState } from "react";
import { Dialog, Button, Input, Alert, Badge } from "@/components/ui";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Device } from "@/api/services/device.service";
import { IotConfig, iotService, toleranceFromRows } from "@/api/services/iot.service";

interface IotDeviceModalProps {
  device: Device | null;
  onClose: () => void;
  hasWriteAccess: boolean;
}

type Row = { metric: string; min: string; max: string };

const rowsFrom = (config: IotConfig): Row[] => {
  const rows = Object.entries(config.readingTolerance ?? {}).map(([metric, b]) => ({
    metric,
    min: b.min === undefined ? "" : String(b.min),
    max: b.max === undefined ? "" : String(b.max),
  }));
  return rows.length ? rows : [{ metric: "", min: "", max: "" }];
};

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

export const IotDeviceModal: React.FC<IotDeviceModalProps> = ({ device, onClose, hasWriteAccess }) => {
  const [config, setConfig] = useState<IotConfig | null>(null);
  const [rows, setRows] = useState<Row[]>([{ metric: "", min: "", max: "" }]);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deviceId = device?.id;
  useEffect(() => {
    if (!deviceId) {
      return undefined;
    }
    let cancelled = false;
    iotService
      .getConfig(deviceId)
      .then((loaded) => {
        if (!cancelled) {
          setConfig(loaded);
          setRows(rowsFrom(loaded));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(messageOf(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (!device) {
    return null;
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const issue = () =>
    run(async () => {
      const issued = await iotService.issueToken(device.id);
      const { token, rotated, ...rest } = issued;
      setIssuedToken(token);
      setConfig(rest);
      setNotice(rotated ? "Token rotated — the previous token no longer works." : "Token issued; ingest is enabled.");
    });

  const revoke = () =>
    run(async () => {
      setConfig(await iotService.revokeToken(device.id));
      setIssuedToken(null);
      setNotice("Token revoked; ingest is disabled.");
    });

  const toggleEnabled = () =>
    run(async () => {
      setConfig(await iotService.updateConfig(device.id, { iotEnabled: !config?.iotEnabled }));
    });

  const saveTolerance = () => {
    const { tolerance, error: invalid } = toleranceFromRows(rows);
    if (invalid) {
      setError(invalid);
      return;
    }
    run(async () => {
      const saved = await iotService.updateConfig(device.id, { readingTolerance: tolerance });
      setConfig(saved);
      setRows(rowsFrom(saved));
      setNotice("Reading tolerance saved.");
    });
  };

  const setRow = (index: number, key: keyof Row, value: string) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <Dialog isOpen onClose={onClose} title={`IoT ingest — ${device.name}`} size="xl">
      <div className="space-y-5 pt-2">
        {error && <Alert variant="error">{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        {!config && !error ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : config ? (
          <>
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Ingest token</h3>
                <Badge variant={config.iotEnabled ? "success" : "secondary"}>
                  {config.iotEnabled ? "Ingest enabled" : "Ingest disabled"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {config.hasToken
                  ? `A token was issued ${config.tokenIssuedAt ? new Date(config.tokenIssuedAt).toLocaleString() : ""}. It cannot be shown again — rotate to get a new one.`
                  : "No token has been issued. The device cannot send readings until one is."}
              </p>

              {issuedToken && (
                <Alert variant="warning">
                  <p className="font-semibold">Copy this token now — it will not be shown again.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="break-all rounded bg-muted px-2 py-1 text-xs" data-testid="iot-token">
                      {issuedToken}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Copy token"
                      onClick={() => navigator.clipboard?.writeText(issuedToken)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-2 text-xs">
                    The device sends it in the <code>x-iot-token</code> header to <code>POST /api/v1/iot/ingest</code>.
                  </p>
                </Alert>
              )}

              {hasWriteAccess && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={issue} disabled={busy}>
                    {config.hasToken ? "Rotate token" : "Issue token"}
                  </Button>
                  {config.hasToken && (
                    <>
                      <Button variant="outline" onClick={toggleEnabled} disabled={busy}>
                        {config.iotEnabled ? "Disable ingest" : "Enable ingest"}
                      </Button>
                      <Button variant="danger" onClick={revoke} disabled={busy}>
                        Revoke token
                      </Button>
                    </>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Reading tolerance</h3>
              <p className="text-sm text-muted-foreground">
                A reading outside these bounds is flagged as an anomaly and raises a notification. Metric names
                are the keys the device sends in its payload.
              </p>
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_7rem_7rem_auto] items-end gap-2">
                  <Input
                    aria-label={`Metric ${i + 1}`}
                    placeholder="metric, e.g. temperature"
                    value={row.metric}
                    onChange={(e) => setRow(i, "metric", e.target.value)}
                    disabled={!hasWriteAccess}
                  />
                  <Input
                    aria-label={`Min ${i + 1}`}
                    placeholder="min"
                    inputMode="decimal"
                    value={row.min}
                    onChange={(e) => setRow(i, "min", e.target.value)}
                    disabled={!hasWriteAccess}
                  />
                  <Input
                    aria-label={`Max ${i + 1}`}
                    placeholder="max"
                    inputMode="decimal"
                    value={row.max}
                    onChange={(e) => setRow(i, "max", e.target.value)}
                    disabled={!hasWriteAccess}
                  />
                  {hasWriteAccess && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove metric ${i + 1}`}
                      onClick={() => setRows((current) => current.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {hasWriteAccess && (
                <div className="flex justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRows((current) => [...current, { metric: "", min: "", max: "" }])}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add metric
                  </Button>
                  <Button onClick={saveTolerance} disabled={busy}>
                    Save tolerance
                  </Button>
                </div>
              )}
            </section>
          </>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default IotDeviceModal;

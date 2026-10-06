// src/app/dashboard/access-requests/page.tsx
"use client";

/**
 * P10-07 — the super admin's access-request queue: a worklist with status tabs
 * and counts, a table, and a side panel for one request with Approve and
 * Reject. Backend: /api/v1/admin/access-requests (super admin only).
 *
 * A non-super-admin who types the URL sees the restriction notice and loads
 * nothing (the API would answer 403; the page must not render an empty list
 * that looks like "no requests"). A 409 shows the backend's state explanation.
 * The dashboard's current look and language (Phase 11 is on hold).
 */
import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Badge, Button, Card, CardContent, ErrorState, Input, Textarea } from "@/components/ui";
import { Inbox, Shield, X } from "lucide-react";
import { describeApiError } from "@/api/client";
import {
  ACCESS_REQUEST_STATUSES,
  accessRequestService,
  suggestTenantCode,
  type AccessRequestDetail,
  type AccessRequestPage,
  type AccessRequestStatus,
} from "@/api/services/accessRequest.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { deferEffect } from "@/lib/deferEffect";
import { toneOf } from "@/lib/statusTone";

const STATUS_LABEL: Record<AccessRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  spam: "Spam",
  expired: "Expired",
};

const FACILITY_LABEL: Record<string, string> = {
  hospital: "Hospital",
  clinic: "Clinic",
  calibration_lab: "Calibration lab",
  other: "Other",
};

const BAND_LABEL: Record<string, string> = {
  lt_100: "< 100",
  "100_499": "100–499",
  "500_1999": "500–1,999",
  gte_2000: "≥ 2,000",
  unknown: "Unknown",
};


const fmt = (value?: string | null) => (value ? new Date(value).toLocaleString() : "—");

/** The message a failed action shows: a 409's state explanation as the backend wrote it. */
const actionError = (err: unknown): string => {
  const d = describeApiError(err);
  return d.message || "The action failed";
};

export default function AccessRequestsPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role?.name === "SUPERADMIN";
  const addToast = useToastStore((s) => s.addToast);

  const [status, setStatus] = useState<AccessRequestStatus>("pending");
  const [page, setPage] = useState<AccessRequestPage | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccessRequestDetail | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);

  const [mode, setMode] = useState<"view" | "approve" | "reject">("view");
  const [form, setForm] = useState({ tenantCode: "", tenantName: "", adminFirstName: "", adminLastName: "" });
  const [reason, setReason] = useState("");
  const [spam, setSpam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSuperAdmin) return;
    setIsLoading(true);
    setListError(null);
    try {
      setPage(await accessRequestService.list(status));
    } catch (err) {
      setListError(err);
      setPage(null);
    } finally {
      setIsLoading(false);
    }
  }, [isSuperAdmin, status]);

  useEffect(() => deferEffect(load), [load]);

  const open = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setMode("view");
    setActionMessage(null);
    try {
      const d = await accessRequestService.get(id);
      setDetail(d);
      const [first, ...rest] = d.contactName.trim().split(/\s+/);
      setForm({
        tenantCode: suggestTenantCode(d.organisationName),
        tenantName: d.organisationName.slice(0, 100),
        adminFirstName: first ?? "",
        adminLastName: rest.join(" ") || (first ?? ""),
      });
    } catch (err) {
      setDetailError(err);
    }
  };

  const close = () => {
    setSelectedId(null);
    setDetail(null);
    setMode("view");
  };

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setActionMessage(null);
    try {
      await fn();
      addToast({ type: "success", title: done });
      close();
      await load();
    } catch (err) {
      // Shown inline: a 409 is a state explanation, not a generic failure.
      setActionMessage(actionError(err));
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    act(
      () =>
        accessRequestService.approve(selectedId as string, {
          tenantCode: form.tenantCode.trim(),
          ...(form.tenantName.trim() ? { tenantName: form.tenantName.trim() } : {}),
          ...(form.adminFirstName.trim() ? { adminFirstName: form.adminFirstName.trim() } : {}),
          ...(form.adminLastName.trim() ? { adminLastName: form.adminLastName.trim() } : {}),
        }),
      "Request approved — the tenant exists and the invitation was sent",
    );

  const reject = () => {
    if (!reason.trim()) {
      setActionMessage("A reason is required");
      return;
    }
    void act(() => accessRequestService.reject(selectedId as string, reason.trim(), spam), spam ? "Marked as spam" : "Request rejected");
  };

  const resend = () => act(() => accessRequestService.resendInvitation(selectedId as string), "Invitation re-issued");

  if (!isSuperAdmin) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">Access Requests</h1>
          <p className="text-muted-foreground">Only a platform super admin can work the access-request queue.</p>
        </div>
      </DashboardLayout>
    );
  }

  const rows = page?.rows ?? [];
  const counts = page?.meta.counts;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Access Requests</h1>
          <p className="text-sm text-muted-foreground">
            Hospitals and calibration labs asking for access. Approving creates the tenant and invites the requester as its
            first administrator.
          </p>
        </div>

        <div role="tablist" aria-label="Request status" className="flex flex-wrap gap-2">
          {ACCESS_REQUEST_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => {
                setStatus(s);
                close();
              }}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                status === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground"
              }`}
            >
              {STATUS_LABEL[s]}
              {counts ? <span className="ml-1.5 opacity-80">({counts[s]})</span> : null}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 border-border">
            <CardContent className="pt-6">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && listError !== null && <ErrorState error={listError} onRetry={() => void load()} />}
              {!isLoading && listError === null && rows.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
                  <p>{status === "pending" ? "No new requests" : `No ${STATUS_LABEL[status].toLowerCase()} requests`}</p>
                </div>
              )}
              {!isLoading && listError === null && rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th scope="col" className="py-2 pr-3">Organisation</th>
                        <th scope="col" className="py-2 pr-3">Type</th>
                        <th scope="col" className="py-2 pr-3">City</th>
                        <th scope="col" className="py-2 pr-3">Devices</th>
                        <th scope="col" className="py-2 pr-3">Contact</th>
                        <th scope="col" className="py-2 pr-3">Received</th>
                        <th scope="col" className="py-2">Duplicates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className={`border-b border-border ${selectedId === r.id ? "bg-muted/50" : ""}`}>
                          <td className="py-2 pr-3">
                            <button type="button" className="font-medium text-primary hover:underline text-left" onClick={() => void open(r.id)}>
                              {r.organisationName}
                            </button>
                          </td>
                          <td className="py-2 pr-3">{FACILITY_LABEL[r.facilityType] ?? r.facilityType}</td>
                          <td className="py-2 pr-3">{r.city}</td>
                          <td className="py-2 pr-3">{BAND_LABEL[r.deviceCountBand] ?? r.deviceCountBand}</td>
                          <td className="py-2 pr-3">
                            {r.contactName}
                            <span className="block text-muted-foreground">{r.workEmail}</span>
                          </td>
                          <td className="py-2 pr-3">{fmt(r.createdAt)}</td>
                          <td className="py-2">{r.duplicateCount > 0 ? <Badge variant="warning">{r.duplicateCount}</Badge> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {page && page.meta.total > rows.length && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Showing {rows.length} of {page.meta.total}, newest first.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedId && (
            <Card className="border-border" aria-labelledby="request-panel-title">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 id="request-panel-title" className="text-lg font-semibold">
                    {detail?.organisationName ?? "Request"}
                  </h2>
                  <Button variant="ghost" size="sm" onClick={close} aria-label="Close the request panel">
                    <X className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
                {detailError !== null && <ErrorState error={detailError} onRetry={() => void open(selectedId)} />}
                {!detail && detailError === null && <p className="text-sm text-muted-foreground">Loading…</p>}
                {detail && (
                  <>
                    <Badge tone={toneOf("accessRequest", detail.status)}>{STATUS_LABEL[detail.status]}</Badge>
                    <dl className="grid grid-cols-1 gap-2 text-sm">
                      <div><dt className="text-muted-foreground">Contact</dt><dd>{detail.contactName}{detail.contactRole ? ` — ${detail.contactRole}` : ""}</dd></div>
                      <div><dt className="text-muted-foreground">Work email</dt><dd>{detail.workEmail}</dd></div>
                      <div><dt className="text-muted-foreground">WhatsApp</dt><dd>{detail.whatsapp}</dd></div>
                      <div><dt className="text-muted-foreground">Facility</dt><dd>{FACILITY_LABEL[detail.facilityType]} · {detail.city} · {BAND_LABEL[detail.deviceCountBand]} devices</dd></div>
                      <div><dt className="text-muted-foreground">Needs</dt><dd className="whitespace-pre-wrap">{detail.needs ?? "—"}</dd></div>
                      <div><dt className="text-muted-foreground">Language</dt><dd>{detail.locale === "id" ? "Bahasa Indonesia" : "English"}</dd></div>
                      <div><dt className="text-muted-foreground">Received</dt><dd>{fmt(detail.createdAt)}</dd></div>
                      {detail.decidedAt && (
                        <div><dt className="text-muted-foreground">Decided</dt><dd>{fmt(detail.decidedAt)}{detail.decidedBy?.name ? ` by ${detail.decidedBy.name}` : ""}</dd></div>
                      )}
                      {detail.decisionNote && <div><dt className="text-muted-foreground">Reason</dt><dd>{detail.decisionNote}</dd></div>}
                      {detail.provisionedTenant && (
                        <div><dt className="text-muted-foreground">Tenant</dt><dd>{detail.provisionedTenant.name} ({detail.provisionedTenant.code})</dd></div>
                      )}
                      {detail.status === "approved" && (
                        <div>
                          <dt className="text-muted-foreground">Invitation</dt>
                          <dd>
                            {detail.invitation.acceptedAt
                              ? `Accepted ${fmt(detail.invitation.acceptedAt)}`
                              : detail.invitation.sentAt
                                ? `Sent ${fmt(detail.invitation.sentAt)} · expires ${fmt(detail.invitation.expiresAt)}`
                                : "Invitation not sent — resend"}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {detail.duplicates.length > 0 && (
                      <Alert variant="warning">
                        {detail.duplicates.length} other request(s) from this address:{" "}
                        {detail.duplicates.map((d) => `${d.organisationName} (${STATUS_LABEL[d.status]})`).join(", ")}
                      </Alert>
                    )}

                    {actionMessage && <Alert variant="error">{actionMessage}</Alert>}

                    {detail.status === "pending" && mode === "view" && (
                      <div className="flex gap-2">
                        <Button onClick={() => setMode("approve")}>Approve</Button>
                        <Button variant="outline" onClick={() => setMode("reject")}>Reject</Button>
                      </div>
                    )}

                    {detail.status === "pending" && mode === "approve" && (
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void approve();
                        }}
                      >
                        <Input id="ar-tenant-code" label="Tenant code" required value={form.tenantCode} onChange={(e) => setForm({ ...form, tenantCode: e.target.value })} />
                        <Input id="ar-tenant-name" label="Tenant name" value={form.tenantName} onChange={(e) => setForm({ ...form, tenantName: e.target.value })} />
                        <Input id="ar-admin-first" label="Administrator first name" value={form.adminFirstName} onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })} />
                        <Input id="ar-admin-last" label="Administrator last name" value={form.adminLastName} onChange={(e) => setForm({ ...form, adminLastName: e.target.value })} />
                        <p className="text-xs text-muted-foreground">
                          The invitation goes to {detail.workEmail} — the address that asked. They set their own password.
                        </p>
                        <div className="flex gap-2">
                          <Button type="submit" isLoading={busy}>Approve and invite</Button>
                          <Button type="button" variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
                        </div>
                      </form>
                    )}

                    {detail.status === "pending" && mode === "reject" && (
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          reject();
                        }}
                      >
                        <label htmlFor="ar-reason" className="block text-sm font-medium">Reason</label>
                        <Textarea id="ar-reason" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={spam} onChange={(e) => setSpam(e.target.checked)} />
                          Mark as spam
                        </label>
                        <div className="flex gap-2">
                          <Button type="submit" variant="danger" isLoading={busy}>Reject</Button>
                          <Button type="button" variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
                        </div>
                      </form>
                    )}

                    {detail.invitation.resendable && (
                      <Button variant="outline" onClick={() => void resend()} isLoading={busy}>
                        Resend invitation
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

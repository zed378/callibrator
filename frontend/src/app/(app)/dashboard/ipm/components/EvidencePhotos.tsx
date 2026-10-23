"use client";

/**
 * C-2 (found by P26-01 § 9; P19-02 spec § 10.2, § 12; ADR-132 Am. 1 § 5) — the IPM capture's
 * EVIDENCE photos on the dashboard checklist. Before this the dashboard could fill an IPM but not
 * attach a photo to it; only the `/field` app could, so a technician at a desk could not record
 * what they saw (UAT step TP-07). The server already accepted them: `POST /attachments` with
 * `resourceType: inspectionsession` sets `purpose = ipm_evidence`, accepts it only while the
 * session is the caller's own draft (403 / 409 `IPM_NOT_DRAFT`) and stamps the session's facility.
 *
 * The photo is made a downscaled JPEG in the browser first (`lib/photoPrep`) — the same pipeline
 * the register uses; the server has no HEIC decoder (ADR-132 Am. 3). An `ipm_evidence` photo has
 * no metadata-free derivative, so the thumbnail is the original through a short-lived signed link.
 * Adding and removing are offered while the draft is the caller's own (the server decides; a
 * refusal is shown in its words). A submitted IPM's photos are part of its record and cannot be
 * deleted (409 `IPM_NOT_DRAFT`).
 */
import React, { useEffect, useRef, useState } from "react";
import { ImageOff, Paperclip, Plus, Trash2 } from "lucide-react";
import { Alert, Button, ConfirmDialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { attachmentService, type Attachment } from "@/api/services/attachment.service";
import { PHOTO_ACCEPT, PhotoPrepError, preparePhoto } from "@/lib/photoPrep";
import { deferEffect } from "@/lib/deferEffect";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";

/** The resource type the server keys an IPM photo by (`LINKABLE_RESOURCES.inspectionsession`). */
export const IPM_EVIDENCE_RESOURCE_TYPE = "inspectionsession";

interface Props {
    sessionId: string;
    /** The draft is the caller's own (the server's rule; another user's is 403). */
    editable: boolean;
}

export function EvidencePhotos({ sessionId, editable }: Props) {
    const { t } = useI18n();
    const [photos, setPhotos] = useState<Attachment[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
    const input = useRef<HTMLInputElement | null>(null);

    const load = async (): Promise<void> => {
        setLoadFailed(false);
        try {
            setPhotos(await attachmentService.listForResource(IPM_EVIDENCE_RESOURCE_TYPE, sessionId));
        } catch {
            setPhotos([]);
            setLoadFailed(true);
        }
    };

    useEffect(
        () =>
            deferEffect(async () => {
                await load();
            }),
        [sessionId],
    );

    const add = async (file: File) => {
        setBusy(true);
        setError(null);
        try {
            const prepared = await preparePhoto(file);
            const photo = await attachmentService.uploadIpmEvidence(sessionId, prepared);
            setPhotos((current) => [photo, ...(current ?? [])]);
        } catch (err) {
            const message =
                err instanceof PhotoPrepError ? t(`devices.photos.prep.${err.reason}` as MessageKey) : describeApiError(err).message || t("ipm.evidence.uploadFailed");
            setError(message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (photo: Attachment) => {
        setConfirmDelete(null);
        setBusy(true);
        setError(null);
        try {
            await attachmentService.remove(photo.id);
            setPhotos((current) => (current ?? []).filter((p) => p.id !== photo.id));
        } catch (err) {
            setError(describeApiError(err).message || t("ipm.evidence.deleteFailed"));
        } finally {
            setBusy(false);
        }
    };

    const count = photos?.length ?? 0;

    return (
        <section aria-labelledby="capture-evidence-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="capture-evidence-heading" className="flex items-center gap-2 text-sm font-semibold">
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                    {t("ipm.evidence.title", { count })}
                </h3>
                {editable && (
                    <>
                        <input
                            ref={input}
                            id="capture-evidence-input"
                            type="file"
                            accept={PHOTO_ACCEPT}
                            capture="environment"
                            className="sr-only"
                            tabIndex={-1}
                            aria-label={t("ipm.evidence.add")}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file) void add(file);
                            }}
                        />
                        <Button
                            size="sm"
                            variant="outline"
                            className="min-h-11"
                            isLoading={busy}
                            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                            onClick={() => input.current?.click()}
                        >
                            {t("ipm.evidence.add")}
                        </Button>
                    </>
                )}
            </div>

            <p className="text-xs text-muted-foreground">{editable ? t("ipm.evidence.leadDraft") : t("ipm.evidence.leadReadOnly")}</p>

            {error && (
                <div role="alert">
                    <Alert variant="error" title={t("ipm.evidence.failedTitle")}>
                        <p>{error}</p>
                    </Alert>
                </div>
            )}
            {loadFailed && (
                <div role="alert">
                    <Alert variant="error" title={t("ipm.evidence.loadFailed")}>
                        <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>
                            {t("ipm.evidence.retry")}
                        </Button>
                    </Alert>
                </div>
            )}

            {photos !== null && photos.length === 0 && !loadFailed && <p className="text-sm text-muted-foreground">{t("ipm.evidence.none")}</p>}

            {photos !== null && photos.length > 0 && (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((photo) => (
                        <li key={photo.id} className="space-y-1">
                            <EvidenceThumb attachmentId={photo.id} alt={photo.originalName || t("ipm.evidence.alt")} unavailable={t("ipm.evidence.unavailable")} />
                            {editable && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="min-h-11"
                                    disabled={busy}
                                    leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                                    onClick={() => setConfirmDelete(photo)}
                                >
                                    {t("ipm.evidence.remove")}
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {confirmDelete && (
                <ConfirmDialog
                    isOpen
                    title={t("ipm.evidence.confirmTitle")}
                    description={t("ipm.evidence.confirmBody")}
                    confirmLabel={t("ipm.evidence.remove")}
                    variant="danger"
                    isLoading={busy}
                    onConfirm={() => void remove(confirmDelete)}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </section>
    );
}

/** One evidence photo, through a short-lived signed link to the original (no derivative exists). */
function EvidenceThumb({ attachmentId, alt, unavailable }: { attachmentId: string; alt: string; unavailable: string }) {
    const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });

    useEffect(
        () =>
            deferEffect(async () => {
                try {
                    setState({ url: await attachmentService.signedLink(attachmentId), failed: false });
                } catch {
                    setState({ url: null, failed: true });
                }
            }),
        [attachmentId],
    );

    if (state.failed) {
        return (
            <span role="img" aria-label={unavailable} className="flex h-32 w-full items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                <ImageOff className="h-4 w-4" aria-hidden="true" />
            </span>
        );
    }
    if (state.url === null) {
        return <span aria-hidden="true" className="block h-32 w-full animate-pulse rounded-md bg-muted" />;
    }
    return (
        // A signed, same-origin link to the stored file: next/image's optimiser would cache it
        // server-side, outliving the link's purpose; a plain <img> loads it once.
        // eslint-disable-next-line @next/next/no-img-element -- see above
        <img src={state.url} alt={alt} loading="lazy" decoding="async" className="h-32 w-full rounded-md border border-border object-cover" />
    );
}

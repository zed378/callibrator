"use client";
/**
 * P22-10c2 — a capture's photos (P19-08 § 8.1): taken with the camera (`capture="environment"`, no
 * permission prompt), admitted (25 MB, room on the phone, re-encoded without metadata), sealed into
 * the store; each shown from its decrypted bytes through an object URL revoked on unmount. Removing
 * one is possible until it is uploaded; a photo is never added after a submit.
 */
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Capture } from "../../engine/model";
import type { PhotoRefusal } from "../../app/photos";
import { useFieldStoreApi, useFieldText } from "../context";

export function PhotoList({ capture, purpose, editable }: { capture: Capture; purpose: string; editable: boolean }) {
  const { t } = useFieldText();
  const api = useFieldStoreApi();
  const [refusal, setRefusal] = useState<PhotoRefusal | null>(null);
  const [busy, setBusy] = useState(false);
  const photos = capture.photos.filter((p) => p.purpose === purpose);

  const add = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    setRefusal(null);
    for (const file of Array.from(files)) {
      const r = await api.getState().addPhoto(capture.localId, file, purpose);
      if (r) setRefusal(r);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{t("field.photo.title", { count: photos.length })}</p>
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <li key={p.photoId} className="space-y-1">
              <Thumb photoId={p.photoId} alt={t("field.photo.alt", { n: i + 1 })} />
              {editable && !p.uploaded && (
                <Button size="sm" variant="ghost" onClick={() => void api.getState().removePhoto(capture.localId, p.photoId)} aria-label={t("field.photo.remove", { n: i + 1 })}>
                  {t("field.photo.removeShort")}
                </Button>
              )}
              {p.uploaded && <span className="block text-xs text-muted-foreground">{t("field.photo.uploaded")}</span>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="space-y-1">
          <label htmlFor={`field-photo-${capture.localId}`} className="block text-sm">
            {t("field.photo.add")}
          </label>
          <input
            id={`field-photo-${capture.localId}`}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={busy}
            className="block w-full text-sm"
            onChange={(e) => void add(e.target.files)}
          />
        </div>
      )}
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {t(`field.photo.refused.${refusal}` as "field.photo.refused.too_large")}
        </p>
      )}
    </div>
  );
}

function Thumb({ photoId, alt }: { photoId: string; alt: string }) {
  const api = useFieldStoreApi();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let live = true;
    void api
      .getState()
      .photo(photoId)
      .then((blob) => {
        if (!live || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [api, photoId]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of a photo decrypted on the phone; next/image cannot load it
    <img src={url} alt={alt} className="aspect-square w-full rounded-md object-cover" />
  ) : (
    <div role="img" aria-label={alt} className="aspect-square w-full rounded-md bg-muted" />
  );
}

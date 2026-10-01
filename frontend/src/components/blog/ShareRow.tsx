"use client";
/**
 * Copy the article's link, or open the native share sheet. P10-13: the labels
 * come from the server page (the request's language); no dictionary ships.
 */
import React, { useState } from "react";
import { Check, Link2, Share2 } from "@/components/icons/static";

export interface ShareRowLabels {
  copy: string;
  copied: string;
  share: string;
}

export default function ShareRow({ title, labels }: { title: string; labels: ShareRowLabels }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url: window.location.href });
      } catch {
        /* user cancelled */
      }
    } else {
      copy();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={copy} className="pub-btn pub-btn-secondary">
        {copied ? (
          <>
            <Check className="h-4 w-4 text-pub-success" aria-hidden="true" /> {labels.copied}
          </>
        ) : (
          <>
            <Link2 className="h-4 w-4" aria-hidden="true" /> {labels.copy}
          </>
        )}
      </button>
      <button type="button" onClick={share} className="pub-btn pub-btn-secondary">
        <Share2 className="h-4 w-4" aria-hidden="true" /> {labels.share}
      </button>
    </div>
  );
}

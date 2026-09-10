"use client";

import React, { useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";

export default function ShareRow({ title }: { title: string }) {
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

  const btn = "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={copy} className={btn}>
        {copied ? (
          <>
            <Check className="h-4 w-4 text-success" /> Copied
          </>
        ) : (
          <>
            <Link2 className="h-4 w-4" /> Copy link
          </>
        )}
      </button>
      <button type="button" onClick={share} className={btn}>
        <Share2 className="h-4 w-4" /> Share
      </button>
    </div>
  );
}

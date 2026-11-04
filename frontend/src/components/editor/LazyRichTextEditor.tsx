"use client";

/**
 * PERF-02 (the 2026-11 audit) — the TipTap editor, loaded when it renders.
 *
 * TipTap and ProseMirror were imported statically by the ticket list (through
 * its "new ticket" modal) and the post editor, so every visit to those pages
 * downloaded the editor even when nobody opened it. `next/dynamic` splits it
 * into its own chunk, fetched the first time the editor mounts. `ssr: false`:
 * the editor already renders nothing on the server (`immediatelyRender:
 * false`), so there is no server HTML to lose. The placeholder keeps the
 * editor's height, so the form does not jump when the chunk arrives.
 */
import dynamic from "next/dynamic";

const LazyRichTextEditor = dynamic(() => import("./RichTextEditor"), {
  ssr: false,
  loading: () => <div className="min-h-80 rounded-xl border border-border bg-muted/30" aria-hidden="true" />,
});

export default LazyRichTextEditor;

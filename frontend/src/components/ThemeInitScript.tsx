"use client";

import { useServerInsertedHTML } from "next/navigation";

/**
 * The pre-hydration theme script. It is inline, so under the page CSP
 * (P7-08, ADR-071) it runs only with the request's nonce — which the root
 * layout reads from the proxy's `x-nonce` header and passes here.
 */
export function ThemeInitScript({ script, nonce }: { script: string; nonce?: string }) {
  useServerInsertedHTML(() => {
    return <script id="theme-init" nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
  });

  return null;
}

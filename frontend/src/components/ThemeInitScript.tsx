"use client";

import { useServerInsertedHTML } from "next/navigation";

export function ThemeInitScript({ script }: { script: string }) {
  useServerInsertedHTML(() => {
    return <script id="theme-init" dangerouslySetInnerHTML={{ __html: script }} />;
  });

  return null;
}

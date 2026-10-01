import React from "react";
import { safeHtml } from "@/lib/safeHtml";

/**
 * Renders the post's HTML body. The backend sanitizes it when it stores and
 * when it serves it (content.service); it is sanitized again HERE, with the
 * same shared policy (A-298), so the page never trusts a single earlier pass.
 * Styled by the `.article-prose` typography block in globals.css.
 */
export default function ArticleBody({ html }: { html: string }) {
  return (
    <div
      className="article-prose max-w-none"
      dangerouslySetInnerHTML={{ __html: safeHtml(html) }}
    />
  );
}

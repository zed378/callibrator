import React from "react";

/**
 * Renders the post's HTML body. The HTML is sanitized server-side at write time
 * (backend content.service sanitize-html), so injecting it here is safe.
 * Styled by the `.article-prose` typography block in globals.css.
 */
export default function ArticleBody({ html }: { html: string }) {
  return (
    <div
      className="article-prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html || "" }}
    />
  );
}

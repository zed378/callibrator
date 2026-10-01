/**
 * The allow-list for a CMS post body (A-298) — ONE policy, applied by the
 * backend when it stores and when it serves a body (content.service), and by
 * the frontend when it renders one (components/blog/ArticleBody). Both build
 * their `sanitize-html` options from this, so the two passes cannot drift.
 *
 * Plain data, no `sanitize-html` import: this package loads nothing but zod.
 *
 * Schemes: http, https and mailto for a link; http and https for an image.
 * `data:` is refused everywhere. It was allowed on `<a href>` until A-298,
 * which let a body carry `<a href="data:text/html,...">` — a same-document
 * script vector in some browsers and a phishing page in all of them. Images
 * do not need it: the editor uploads a pasted image and inserts its URL
 * (RichTextEditor), so a `data:` image only ever arrives hand-crafted.
 * Relative URLs (the host-relative `/uploads/public/...` the editor inserts)
 * carry no scheme and are kept.
 */

/** sanitize-html's option shape for the fields this policy sets. */
export interface ContentHtmlPolicy {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
  allowedStyles: Record<string, Record<string, RegExp[]>>;
  allowedSchemes: string[];
  allowedSchemesByTag: Record<string, string[]>;
  nonTextTags: string[];
}

/** Link schemes a body may carry. */
export const CONTENT_HTML_LINK_SCHEMES = ["http", "https", "mailto"] as const;

/** Image schemes a body may carry. */
export const CONTENT_HTML_IMAGE_SCHEMES = ["http", "https"] as const;

// sanitize-html 2.17's default tags, listed rather than read from the library
// so the policy is the same on both ends whatever version each resolves, plus
// `img` (the editor's images). `figure`, `figcaption`, `h1`, `h2`, `u`, `s`
// and `span`, which content.service used to concat, are already defaults.
const TAGS = [
  "address", "article", "aside", "footer", "header",
  "h1", "h2", "h3", "h4", "h5", "h6", "hgroup", "main", "nav", "section",
  "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "hr", "li", "menu", "ol", "p", "pre", "ul",
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q",
  "rb", "rp", "rt", "rtc", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
  "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "img",
];

/**
 * A fresh copy of the policy (nothing shared is mutable, so no caller can
 * widen it for the other).
 *
 * @returns the options each end hands to sanitize-html
 */
export const contentHtmlPolicy = (): ContentHtmlPolicy => ({
  allowedTags: [...TAGS],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    "*": ["style"],
  },
  allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  allowedSchemes: [...CONTENT_HTML_LINK_SCHEMES],
  allowedSchemesByTag: { img: [...CONTENT_HTML_IMAGE_SCHEMES] },
  // Drop these tags AND their inner content entirely (don't escape to text).
  nonTextTags: ["script", "style", "textarea", "noscript"],
});

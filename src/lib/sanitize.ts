import DOMPurify from "dompurify";

/**
 * The DOMPurify settings for a note's rich text: the tags and attributes the
 * composer's editor writes, so stored HTML cannot carry anything else through
 * to the page. Any `data-` attribute passes. A link preview card needs `div`
 * and `img`, which this does not allow, so `sanitizeNote` makes it a link
 * first.
 */
const TIPTAP_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "a",
    "ul",
    "ol",
    "li",
    "span",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "code",
    "pre",
    "hr",
  ],
  // A link's, and a mention span's.
  ALLOWED_ATTR: ["href", "target", "rel", "data-type", "data-id", "class"],
};

/**
 * Each saved link preview card as a paragraph with a link: the page's title,
 * or its address when the card has no title. The editor draws a card with
 * `div` and `img`, so left in place the sanitizer would run its text together.
 */
function flattenLinkPreviews(html: string): string {
  if (!/<link-preview[\s>]/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const card of doc.body.querySelectorAll("link-preview")) {
    const url = card.getAttribute("url");
    if (!url) {
      card.remove();
      continue;
    }
    const link = doc.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.textContent = card.getAttribute("title")?.trim() || url;
    const paragraph = doc.createElement("p");
    paragraph.append(link);
    card.replaceWith(paragraph);
  }
  return doc.body.innerHTML;
}

/** A saved note's HTML, safe to show on the page. */
export function sanitizeNote(html: string): string {
  return DOMPurify.sanitize(flattenLinkPreviews(html), TIPTAP_SANITIZE_CONFIG);
}

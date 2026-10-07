/**
 * The DOMPurify settings for a note's rich text: the tags and attributes the
 * composer's editor writes, so stored HTML cannot carry anything else through
 * to the page. Any `data-` attribute passes. A link preview card needs `div`
 * and `img`, which this does not allow.
 */
export const TIPTAP_SANITIZE_CONFIG = {
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

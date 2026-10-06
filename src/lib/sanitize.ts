/**
 * The DOMPurify settings for a note's rich text: the tags and attributes the
 * composer writes, so stored HTML cannot carry anything else through to the
 * page. The composer can also write `h4` to `h6` and `hr`, which this removes:
 * DOMPurify keeps the text of a removed tag. Any `data-` attribute passes.
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
    "blockquote",
    "code",
    "pre",
  ],
  // A link's, and a mention span's.
  ALLOWED_ATTR: ["href", "target", "rel", "data-type", "data-id", "class"],
};

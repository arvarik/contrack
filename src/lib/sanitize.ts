/**
 * Shared DOMPurify configuration for TipTap-authored rich text.
 *
 * Pins ALLOWED_TAGS/ALLOWED_ATTR to exactly what the RichInteractionComposer
 * (TipTap) emits — paragraphs, basic marks, links, lists, mention spans,
 * headings, blockquotes, and code blocks — so stored HTML cannot smuggle
 * unexpected elements or attributes through render-time sanitization.
 *
 * @module lib/sanitize
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
  // a[href,target,rel] + span[data-type,data-id,class] (mention nodes)
  ALLOWED_ATTR: ["href", "target", "rel", "data-type", "data-id", "class"],
};

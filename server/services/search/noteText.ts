// =============================================================================
// Note text — the plain text of an interaction body
// =============================================================================
// The composer stores TipTap HTML. Indexing that HTML directly would put tag
// names, attribute names and mention ids into the search index, so a query
// for "span" or "li" would match every formatted note and a snippet would
// carry markup into the page. This module turns the stored HTML into the text
// a person reads, once, on the way into the index.
//
// The same function is registered on the database connection as the SQL
// function `contrack_note_text`, which the interactions_fts triggers call.
// That is what lets one set of triggers cover every write path — the
// composer, an email import, a merge, a seed script — without each path
// having to remember to maintain a derived column.
// =============================================================================

/** The longest body the index keeps. Longer notes are indexed up to here. */
export const NOTE_TEXT_LIMIT = 200_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/** Decode the entities TipTap and pasted text produce. Unknown ones stay. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED_ENTITIES[lower] ?? whole;
    },
  );
}

/**
 * The readable text of a note body.
 *
 * Tags become spaces so that `<p>one</p><p>two</p>` reads "one two" and not
 * "onetwo". Entities are decoded after the tags are gone, so a literal
 * `&lt;b&gt;` in a note stays the text "<b>" a person typed. Control
 * characters are dropped: the search service uses two of them as highlight
 * markers and a note must not be able to forge one. Whitespace collapses to
 * single spaces.
 *
 * @param html - The stored body, HTML or plain text. May be null.
 * @returns The plain text, or null when nothing readable is left.
 */
export function notePlainText(html: string | null | undefined): string | null {
  if (html == null) return null;
  const text = decodeEntities(
    String(html)
      .slice(0, NOTE_TEXT_LIMIT)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  )
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length ? text : null;
}

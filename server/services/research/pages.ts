// =============================================================================
// Research — the text of a result page
// =============================================================================
// A web search sends results, and a technique that reads them needs each
// page's text. A service that sends the text with the result needs no fetch.
// For any other, the page is fetched here.
//
// Web pages are hostile input by construction: every fetch goes through the
// shared SSRF guards (safeFetch), the response is size-capped, and the text
// goes into a prompt only inside wrapUntrusted() (buildReadingPrompt).
// =============================================================================

import * as cheerio from "cheerio/slim";
import { safeFetch, readBodyCapped } from "../../utils/urlSafety.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import type { WebResult } from "./types.ts";

/** Characters of text kept per page. */
const MAX_PAGE_CHARS = 6_000;

/** Fetch a result page and reduce it to readable text. Null when it cannot be read. */
async function fetchPageText(
  pageUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { response } = await safeFetch(pageUrl, { timeoutMs: 8_000, signal });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      return null;
    }
    return pageText(await readBodyCapped(response, signal));
  } catch (err) {
    log.debug("Research", `Skipped ${pageUrl}: ${getErrorMessage(err)}`);
    return null;
  }
}

/**
 * The readable text of a fetched page, without scripts, styles and page
 * chrome, cut to MAX_PAGE_CHARS.
 *
 * cheerio/slim parses with htmlparser2, which adds no <body> to a fragment
 * or a text/plain answer the way a browser's parser does. So the whole
 * document is read when it has no body element, with the head and title
 * removed first.
 */
export function pageText(html: string): string | null {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg, head, title").remove();
  const body = $("body");
  const raw = body.length > 0 ? body.text() : $.root().text();
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_PAGE_CHARS) : null;
}

/**
 * A result page's text: the text the web search sent with it, or else the
 * page, fetched. Null when there is none.
 */
export async function textOf(
  result: WebResult,
  signal?: AbortSignal,
): Promise<string | null> {
  const sent = result.content?.replace(/\s+/g, " ").trim();
  if (sent) return sent.slice(0, MAX_PAGE_CHARS);
  return fetchPageText(result.url, signal);
}

// =============================================================================
// Contracts: AI settings (request schemas only)
// =============================================================================
// The /api/settings/ai routes have no contract yet: they are in
// `UNCONTRACTED` in `index.ts`. Their other bodies are still written in
// `server/routes/aiSettings.ts`.
// =============================================================================

import { z } from "zod";

function isCloudMetadataOrLinkLocal(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const parts = host.split(".");
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const [a, b] = parts.map(Number);
      if (a === 169 && b === 254) return true; // cloud metadata
      if (a === 0) return true;
    }
    return host.startsWith("fe80:") || host.includes("::ffff:169.254.");
  } catch {
    return true;
  }
}

/**
 * A SearXNG base URL, or "" to remove it. An operator's own SearXNG is often
 * on a private address, which is allowed, but a cloud metadata or a
 * link-local address never is.
 */
export const searxngUrlSchema = z
  .string()
  .trim()
  .url("Must be a valid URL")
  .refine((val) => !isCloudMetadataOrLinkLocal(val), {
    message: "Cloud metadata and link-local addresses are not permitted",
  })
  .or(z.literal(""));

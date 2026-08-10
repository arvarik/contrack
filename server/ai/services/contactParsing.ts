// =============================================================================
// AI Services — Contact Parsing (Magic Paste, bulk import)
// =============================================================================
// Extracted verbatim from aiService.ts in the domain split; the barrel there
// re-exports this module, so import sites are unchanged.
// =============================================================================

import type { ParsedContact } from "../types.ts";
import { ParallelQueue } from "../routing/ParallelQueue.ts";
import { getAITier } from "../routing/registry.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { recordInvocation } from "../../services/aiStatsService.ts";
import {
  wrapUntrusted,
  UNTRUSTED_DATA_RULE,
  sanitizeAiOutputValue,
} from "../promptSafety.ts";
import { generateFor } from "../gateway.ts";
import { isMockMode, safeParseJson } from "./shared.ts";

/** Fields that must look like a URL to be worth storing. */
function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = sanitizeAiOutputValue(value, 500);
  if (!cleaned) return undefined;
  // Accept bare domains ("acme.com") by assuming https.
  const candidate = /^https?:\/\//i.test(cleaned)
    ? cleaned
    : `https://${cleaned}`;
  try {
    const url = new URL(candidate);
    // A hostname with no dot ("localhost", or a model's freeform prose) is not
    // a contact's website.
    if (!url.hostname.includes(".") || /\s/.test(url.hostname))
      return undefined;
    // Userinfo means either the model put an email here (observed) or the
    // source contained a `https://real-site.com@evil.com` lookalike.
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Strip control characters, injection echoes, and implausible values. */
function cleanText(value: unknown, maxLength = 2_000): string | undefined {
  if (typeof value !== "string") return undefined;
  return sanitizeAiOutputValue(value, maxLength) ?? undefined;
}

/**
 * Model output is untrusted input: it may echo injected instructions or, on a
 * bad generation, spill reasoning text into a field. Everything the parser
 * returns passes through here before it can reach a contact record.
 */
function normalizeParsedContact(parsed: ParsedContact): ParsedContact {
  const clean: ParsedContact = {
    name: cleanText(parsed.name, 200) ?? "",
    firstName: cleanText(parsed.firstName, 100),
    lastName: cleanText(parsed.lastName, 100),
    headline: cleanText(parsed.headline, 300),
    company: cleanText(parsed.company, 200),
    role: cleanText(parsed.role, 200),
    location: cleanText(parsed.location, 200),
    about: cleanText(parsed.about, 5_000),
    pronouns: cleanText(parsed.pronouns, 50),
    industry: cleanText(parsed.industry, 100),
    website: cleanUrl(parsed.website),
  };

  clean.emails = parsed.emails
    ?.map((e) => ({
      email: cleanText(e?.email, 320) ?? "",
      label: cleanText(e?.label, 50),
    }))
    // Loose shape check only — the DB layer owns strict validation.
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email));

  clean.phones = parsed.phones
    ?.map((p) => ({
      phone: cleanText(p?.phone, 50) ?? "",
      label: cleanText(p?.label, 50),
    }))
    .filter((p) => /\d/.test(p.phone));

  clean.socialLinks = parsed.socialLinks
    ?.map((s) => ({
      platform: cleanText(s?.platform, 50) ?? "",
      url: cleanUrl(s?.url) ?? "",
    }))
    .filter((s) => s.platform && s.url);

  clean.education = parsed.education
    ?.map((e) => ({
      school: cleanText(e?.school, 200) ?? "",
      degree: cleanText(e?.degree, 200),
      fieldOfStudy: cleanText(e?.fieldOfStudy, 200),
      startDate: cleanText(e?.startDate, 50),
      endDate: cleanText(e?.endDate, 50),
    }))
    .filter((e) => e.school);

  clean.experience = parsed.experience
    ?.map((x) => ({
      company: cleanText(x?.company, 200) ?? "",
      role: cleanText(x?.role, 200),
      startDate: cleanText(x?.startDate, 50),
      endDate: cleanText(x?.endDate, 50),
      isCurrent: typeof x?.isCurrent === "boolean" ? x.isCurrent : undefined,
      description: cleanText(x?.description, 2_000),
      location: cleanText(x?.location, 200),
    }))
    .filter((x) => x.company);

  return clean;
}

/**
 * Parses raw, unstructured text to extract contact fields accurately.
 * Returns a structured object compatible with the normalized schema —
 * emails, phones, socialLinks, education, experience are returned as
 * arrays that the server will insert into child tables.
 */
export async function parseContactRecord(text: string): Promise<ParsedContact> {
  if (isMockMode()) {
    throw new Error("AI provider not configured. Cannot run Auto-Parser.");
  }

  const systemPrompt = `You are an expert contact data extraction system.
    Your only job is to read unstructured text and extract contact fields with high precision.
    You NEVER invent or infer data not explicitly stated in the text.

${UNTRUSTED_DATA_RULE}`;

  const prompt = `
    Extract contact information from the following unstructured text. 
    Map it to the structured schema reliably. If a field cannot be derived, omit it (leave it null/empty).
    For firstName and lastName, split from the full name if possible.
    For headline, extract a professional headline or tagline if present.
    For industry, extract the industry vertical if mentioned.
    For experience entries, try to determine if a role is current (isCurrent).
    For education entries, try to extract the field of study separately from degree.

    ${wrapUntrusted("contact text payload", text)}
  `;

  const result = await generateFor("quick", {
    systemPrompt,
    prompt,
    responseFormat: "json",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        headline: { type: "string" },
        company: { type: "string" },
        role: { type: "string" },
        location: { type: "string" },
        about: { type: "string" },
        pronouns: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        emails: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              label: { type: "string" },
            },
          },
        },
        phones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              phone: { type: "string" },
              label: { type: "string" },
            },
          },
        },
        socialLinks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform: { type: "string" },
              url: { type: "string" },
            },
          },
        },
        education: {
          type: "array",
          items: {
            type: "object",
            properties: {
              school: { type: "string" },
              degree: { type: "string" },
              fieldOfStudy: { type: "string" },
              startDate: { type: "string" },
              endDate: { type: "string" },
            },
          },
        },
        experience: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              role: { type: "string" },
              startDate: { type: "string" },
              endDate: { type: "string" },
              isCurrent: { type: "boolean" },
              description: { type: "string" },
              location: { type: "string" },
            },
          },
        },
      },
      required: ["name"],
    },
  });

  const parsed = safeParseJson<ParsedContact>(
    result.text,
    "parseContactRecord",
  );
  if (!parsed)
    throw new Error("AI returned malformed JSON for contact parsing");

  const clean = normalizeParsedContact(parsed);

  log.info(
    "AIService",
    `parseContactRecord → "${clean.name}" via ${result.model} in ${result.latencyMs}ms | Tokens: ${result.tokenCount ?? "?"}`,
  );
  recordInvocation({
    operation: "parse",
    model: result.model,
    tokenCount: result.tokenCount,
    latencyMs: result.latencyMs,
    cached: false,
    description: `Parse: ${(clean.name || text.slice(0, 30)).slice(0, 60)}`,
  });
  return clean;
}

/**
 * Parse multiple unstructured contact texts in parallel with tier-aware
 * concurrency. Uses ParallelQueue to enforce concurrency limits and
 * delegates each item to `parseContactRecord` for DRY prompt/schema reuse.
 *
 * Concurrency adapts to AI_TIER automatically:
 *   - PAID → 10 concurrent workers (10K RPM headroom)
 *   - FREE → 2 concurrent workers (conservative for ~10 RPM limits)
 *
 * Individual failures are isolated — one bad text never crashes the batch.
 * Failed items return `null` in the result array.
 *
 * @param texts       - Array of unstructured text strings to parse
 * @param concurrency - Override automatic tier-based concurrency
 * @returns           - Array of parsed contacts (or null for failed items),
 *                      in the same order as the input array
 */
export async function bulkParseContacts(
  texts: string[],
  concurrency?: number,
): Promise<(ParsedContact | null)[]> {
  if (isMockMode()) {
    throw new Error("AI provider not configured. Cannot run bulk parser.");
  }

  if (texts.length === 0) return [];

  // Adapt concurrency to tier if not explicitly provided
  // Non-Gemini providers (OpenAI, Anthropic) are always paid — no RPM restrictions
  // that justify the conservative FREE tier concurrency of 2.
  const tier = getAITier();
  const providerName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const effectiveConcurrency =
    concurrency ?? (providerName !== "gemini" ? 10 : tier === "PAID" ? 10 : 2);

  log.info(
    "AIService",
    `bulkParseContacts: ${texts.length} items | concurrency: ${effectiveConcurrency} (${tier})`,
  );
  const startMs = Date.now();

  const results = await ParallelQueue.process(
    texts,
    effectiveConcurrency,
    async (text, index) => {
      try {
        return await parseContactRecord(text);
      } catch (error: unknown) {
        log.warn(
          "AIService",
          `bulkParseContacts: item ${index + 1}/${texts.length} failed: ${getErrorMessage(error)}`,
        );
        throw error; // ParallelQueue captures as Error in results array
      }
    },
  );

  const successes = results.filter((r) => !(r instanceof Error)).length;
  const failures = results.length - successes;

  log.info(
    "AIService",
    `bulkParseContacts: ${successes}/${texts.length} succeeded, ${failures} failed in ${Date.now() - startMs}ms`,
  );
  recordInvocation({
    operation: "bulkParse",
    latencyMs: Date.now() - startMs,
    cached: false,
    description: `Bulk Parse: ${texts.length} contacts (${successes} ok, ${failures} failed)`,
  });

  return results.map((r) => (r instanceof Error ? null : r));
}

/** Exposed for unit tests — not part of the module's public surface. */
export const _internal = { normalizeParsedContact, cleanUrl, cleanText };

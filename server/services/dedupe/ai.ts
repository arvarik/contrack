import { ai } from "../../ai/index.ts";
import { wrapUntrusted, UNTRUSTED_DATA_RULE } from "../../ai/promptSafety.ts";
import { log } from "../../utils/logger.ts";
import type { NormalizedContact } from "./normalization.ts";
import type { ContactRow, MatchSignals } from "./types.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

/** Enhanced system prompt for timeline-aware duplicate detection. */
const AI_SYSTEM_PROMPT = `${UNTRUSTED_DATA_RULE}

You are a contact de-duplication expert for a personal CRM.
You determine if two contact records represent the same real-world person.
You are conservative — only flag as duplicate when genuinely confident.

IMPORTANT REASONING GUIDELINES:
- Consider career progression: a person may have changed companies, titles, or locations
  (e.g., "SWE at Stripe" in 2022 → "Founder of Acme AI" in 2024 is plausible)
- Consider name evolution: married names, preferred names, cultural naming patterns
- Consider data staleness: Apple Contacts may have outdated info vs. LinkedIn's current profile
- If contacts were imported from DIFFERENT sources (Apple vs LinkedIn), the same person
  appearing in both is expected and common
- If both contacts share similar professional context (industry, location, network), weigh that as evidence`;

/**
 * Evaluate a batch of candidate pairs via AI.
 * Enhanced with source platform info and embedding similarity context.
 */
export async function evaluateBatchWithAI(
  candidates: {
    idx: number;
    a: ContactRow;
    b: ContactRow;
    nA: NormalizedContact;
    nB: NormalizedContact;
    signals: MatchSignals;
    score: number;
  }[],
  rid: string,
): Promise<
  { idx: number; isDuplicate: boolean; confidence: number; reasoning: string }[]
> {
  if (candidates.length === 0) return [];

  const pairDescriptions = candidates
    .map((c) => {
      const srcA =
        c.nA.sources.length > 0 ? c.nA.sources.join(", ") : "unknown";
      const srcB =
        c.nB.sources.length > 0 ? c.nB.sources.join(", ") : "unknown";
      const emailsA = c.nA.emailsNorm.join(", ") || "(none)";
      const emailsB = c.nB.emailsNorm.join(", ") || "(none)";
      const phonesA = c.nA.phonesNorm.join(", ") || "(none)";
      const phonesB = c.nB.phonesNorm.join(", ") || "(none)";

      let signals = `Name similarity: ${(c.signals.nameJaroWinkler * 100).toFixed(0)}%`;
      if (c.signals.nameMetaphoneMatch) signals += ", phonetically similar";
      if (c.signals.nicknameMatch) signals += ", possible nickname";
      if (c.signals.companyMatch) signals += ", same company";
      if (c.signals.locationOverlap) signals += ", same location";
      if (c.signals.isCrossSource) signals += ", different import sources";
      if (c.signals.embeddingSimilarity > 0)
        signals += `, embedding similarity: ${(c.signals.embeddingSimilarity * 100).toFixed(0)}%`;
      signals += `, composite score: ${(c.score * 100).toFixed(0)}%`;

      return `Pair ${c.idx}:
  Contact A: "${c.a.name}" | Company: ${c.a.company || "(none)"} | Role: ${c.a.role || "(none)"} | Location: ${c.a.location || "(none)"} | Emails: ${emailsA} | Phones: ${phonesA} | Source: ${srcA}
  Contact B: "${c.b.name}" | Company: ${c.b.company || "(none)"} | Role: ${c.b.role || "(none)"} | Location: ${c.b.location || "(none)"} | Emails: ${emailsB} | Phones: ${phonesB} | Source: ${srcB}
  Signals: ${signals}`;
    })
    .join("\n\n");

  try {
    const result = await ai.generate({
      systemPrompt: AI_SYSTEM_PROMPT,
      prompt: `For each pair below, determine if they represent the SAME real-world person.

Consider: common nickname variants (Bob/Robert, Bill/William, Mike/Michael), abbreviations, typos, professional context (same company, role, location), and career progression. Be CONSERVATIVE — only flag duplicates when genuinely confident.

${wrapUntrusted("candidate pairs", pairDescriptions, 24_000)}

For each pair, return your assessment.`,
      responseFormat: "json",
      routing: { prefer: "flash" },
      jsonSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            idx: { type: "number" },
            isDuplicate: { type: "boolean" },
            confidence: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["idx", "isDuplicate", "confidence", "reasoning"],
        },
      },
    });

    if (!result.text?.trim()) return [];
    const results = JSON.parse(result.text) as {
      idx: number;
      isDuplicate: boolean;
      confidence: number;
      reasoning: string;
    }[];
    log.info(
      "DedupeService",
      `[${rid}] AI evaluated ${results.length} pairs via ${result.model} in ${result.latencyMs}ms`,
    );
    return results;
  } catch (err: unknown) {
    log.error(
      "DedupeService",
      `[${rid}] AI batch evaluation failed: ${getErrorMessage(err)}`,
    );
    return [];
  }
}

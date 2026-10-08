// Contact parsing, for Add from text. aiService.ts re-exports it.
//
// The answer is read with research's output schema (`parseExtraction` and
// `tidyExtraction`), one field and one list entry at a time, so a bad value
// costs only itself. Every string passes `sanitizeAiOutputValue` first.

import { z } from "zod";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import { recordInvocation } from "../../services/aiStatsService.ts";
import {
  EMPTY_WORDS,
  extractionJsonSchema,
  parseExtraction,
  tidyExtraction,
  type AISearchOutput,
} from "../../services/aiSearch/promptTemplate.ts";
import { answerTokens } from "../../services/research/evidence.ts";
import { birthdayValue, parseBirthday } from "../../../shared/birthday.ts";
import { addCalendarDays, dayInZone } from "../../../shared/dates.ts";
import {
  wrapUntrusted,
  UNTRUSTED_DATA_RULE,
  sanitizeAiOutputValue,
} from "../promptSafety.ts";
import { generateFor } from "../gateway.ts";
import type { JsonSchemaNode } from "../types.ts";
import { isMockMode, safeParseJson } from "./shared.ts";

/** The most text one read takes: pages of notes, a few thousand tokens. */
export const PASTE_MAX_CHARS = 20_000;

/** The kinds the composer logs, and so the kinds a found interaction takes. */
const KINDS = ["meeting", "call", "email", "note"] as const;

/** At most this many interactions come back from one text. */
const MAX_INTERACTIONS = 10;

const interactionSchema = z.object({
  type: z.enum(KINDS).catch("note"),
  // A day the text gives or implies, or none: the person picks it.
  date: z.iso
    .date()
    .nullish()
    .catch(null)
    .transform((day) => day ?? undefined),
  summary: z.string().trim().min(1).max(2_000),
});

export type ParsedInteraction = z.infer<typeof interactionSchema>;

/** A contact's fields as pasted text gives them, and what happened with them. */
export type ParsedContact = AISearchOutput & {
  name: string;
  firstName?: string;
  lastName?: string;
  interactions?: ParsedInteraction[];
};

const nullableText: JsonSchemaNode = { type: "string", nullable: true };

const properties: Record<string, JsonSchemaNode> = {
  name: nullableText,
  firstName: nullableText,
  lastName: nullableText,
  ...extractionJsonSchema.properties,
  interactions: {
    type: "array",
    items: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...KINDS] },
        date: nullableText,
        summary: { type: "string" },
      },
      required: ["type", "summary"],
    },
  },
};

// Every key is required, and a value can be null or an empty list. With all
// of them optional, Gemini 3.5 Flash-Lite answered 5 reads of 8 with only a
// name and tags.
const jsonSchema: JsonSchemaNode = {
  type: "object",
  properties,
  required: Object.keys(properties),
};

const SYSTEM_PROMPT = `You read text about one person into contact fields. You never invent or infer what the text does not state.

${UNTRUSTED_DATA_RULE}`;

/** "Tuesday" for 2026-10-06. */
const weekday = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });

function buildPrompt(text: string, today: string): string {
  // The days are listed, with a worked example. Asked to count back to
  // "last Tuesday" from a Thursday, Flash-Lite went a week too far in 7
  // reads of 8, and with the list and the example in 1 of 8.
  const week = [1, 2, 3, 4, 5, 6, 7].map((back) =>
    addCalendarDays(today, -back),
  );
  const named = (day: string) => `${weekday(day)} ${day}`;
  return `
Below is text the user pasted about one person: an email signature, a bio, a profile or notes from meeting them. Put what it says about that person into the JSON schema.

Today is ${named(today)}. The seven days before it: ${week.map(named).join(", ")}.

Rules:
- Use only what the text states. Do not add, guess or infer anything.
- The person is the one the text is about, never its writer. When it names several people, choose the one it says most about.
- name: the full name as written, or null when the text gives none. firstName and lastName split from it.
- emails and phones: the person's own, labeled work, home or mobile when the text says which.
- socialLinks: one entry per profile address. platform is lower case: linkedin, github, x, instagram, facebook, youtube, medium, substack, or the site's own name.
- website: the person's own site, when the text names one.
- experience: one entry per job. isCurrent is true for a current job. Dates as "YYYY-MM" when the month is known, else "YYYY".
- education: one entry per school and degree. The degree is only the degree and the field goes in fieldOfStudy: "BA Economics" is degree "BA", fieldOfStudy "Economics".
- headline: a short professional headline, like "VP Engineering at Stripe".
- about: two to four sentences on who they are and their work. Null when the text says nothing beyond the role.
- industry: the industry of their current work, in two to four words.
- location: where they live or work, as "City, State or Region, Country".
- birthday: as "YYYY-MM-DD", or "MM-DD" when the text gives no year.
- tags: up to eight short lower-case tags for their specialties and domain expertise, like "fintech" or "machine learning".
- interests: up to six short labels for hobbies and personal interests, like "Marathon running".
- attributes: notable facts that fit no field above, like languages, awards, board seats or how the user met them. Name each kind for what it is ("Languages", "How we met"), and join several values with "; ".
- addresses: a postal address the text gives as theirs, as it is written.
- interactions: each meeting, call, email or message between the user and this person that the text says already happened, at most ${MAX_INTERACTIONS}. type is meeting, call, email or note. date is the day as "YYYY-MM-DD" when the text gives or implies it, else null. A day written with no year, like "Sept 3", is the last one on or before today. "Yesterday" is the first of the seven days, and a weekday alone or after "last" is the one among them: "last ${weekday(week[2])}" is ${week[2]}. summary is one to three sentences on what was discussed or agreed. Leave out a meeting that is only planned.
Return null or an empty list for anything the text does not state.

${wrapUntrusted("pasted contact text", text, PASTE_MAX_CHARS)}
  `.trim();
}

/**
 * Every string in a model's answer through `sanitizeAiOutputValue`. A value
 * that echoes injected instructions, or holds only control characters, is
 * null, and the schema then leaves it out.
 */
function scrub(value: unknown): unknown {
  if (typeof value === "string") return sanitizeAiOutputValue(value, 4_000);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrub(item)]),
    );
  return value;
}

const namePart = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : undefined;

/**
 * Read pasted text into contact fields, and into the interactions it says
 * already happened.
 *
 * @param text - What the user pasted, at most `PASTE_MAX_CHARS`.
 * @param today - The user's day, as YYYY-MM-DD, against which "yesterday" in
 *   the text is read. An interaction dated after it is a plan, and is left out.
 */
export async function parseContactRecord(
  text: string,
  today: string = dayInZone(new Date()) ?? "",
): Promise<ParsedContact> {
  if (isMockMode()) {
    throw new AppError("Add from text needs an AI provider", 503);
  }

  const prompt = buildPrompt(text, today);
  const result = await generateFor("quick", {
    systemPrompt: SYSTEM_PROMPT,
    prompt,
    responseFormat: "json",
    jsonSchema,
    maxOutputTokens: answerTokens("quick", prompt),
  });

  const raw = safeParseJson<unknown>(result.text, "parseContactRecord");
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AppError("The AI answer could not be read. Try again", 502, {
      code: "AI_INVALID_JSON",
    });
  const answer = scrub(raw) as Record<string, unknown>;
  const name = namePart(answer.name, 200);
  if (!name || EMPTY_WORDS.test(name))
    throw new AppError(
      "The text names no person. Add their name and try again",
      422,
      { code: "NO_NAME_FOUND" },
    );

  const { data, dropped } = parseExtraction(answer);
  const found = Array.isArray(answer.interactions) ? answer.interactions : [];
  const interactions = found
    .flatMap((entry) => {
      const item = interactionSchema.safeParse(entry);
      return item.success && !(item.data.date && item.data.date > today)
        ? [item.data]
        : [];
    })
    .slice(0, MAX_INTERACTIONS);
  if (interactions.length < Math.min(found.length, MAX_INTERACTIONS))
    dropped.push("interactions");
  if (dropped.length > 0)
    log.warn(
      "AIService",
      `parseContactRecord: ${result.model} wrote values the schema refused; left out: ${dropped.join(", ")}`,
    );

  const birthday = parseBirthday(data.birthday);
  const tidy = tidyExtraction(data, {
    company: data.company ?? "",
    location: data.location ?? null,
  });
  const contact: ParsedContact = {
    ...tidy,
    name,
    firstName: namePart(answer.firstName, 100),
    lastName: namePart(answer.lastName, 100),
    birthday: birthday ? birthdayValue(birthday) : undefined,
    // A model wrote each one, as with research's interests.
    interests: tidy.interests?.map(({ interest }) => ({
      interest,
      isAiGenerated: true,
    })),
    ...(interactions.length > 0 && { interactions }),
  };

  log.info(
    "AIService",
    `parseContactRecord → one record via ${result.model} in ${result.latencyMs}ms | Tokens: ${result.tokenCount ?? "?"}`,
  );
  recordInvocation({
    operation: "parse",
    model: result.model,
    tokenCount: result.tokenCount,
    latencyMs: result.latencyMs,
    cached: false,
    description: `Parse: ${name.slice(0, 60)}`,
  });
  return contact;
}

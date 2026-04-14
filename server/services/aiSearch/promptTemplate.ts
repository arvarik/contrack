// =============================================================================
// AI Search — Prompt Template & Output Schema
// =============================================================================
// Builds a research prompt from a HydratedContact and defines the Zod
// validation schema for the structured extraction pass output.
//
// Design decisions:
// - Include everything known to help disambiguate common names
// - Explicit grounding instructions ("You MUST use Google Search")
// - Null-safety: only include non-null fields to keep prompt clean
// - Token efficiency: strip IDs and metadata, keep only semantic data
// - Email-domain disambiguation for corporate contacts
// - Negative examples to prevent common hallucination patterns
// =============================================================================

import { z } from "zod";
import type { HydratedContact } from "../../repositories/types.ts";
import type { JsonSchemaNode } from "../../ai/types.ts";

// =============================================================================
// Prompt Builder
// =============================================================================

/** Common free-email domains that offer zero disambiguation signal. */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'aol.com', 'protonmail.com', 'live.com',
  'mail.com', 'zoho.com', 'yandex.com',
]);

export function buildSearchPrompt(contact: HydratedContact): string {
  const known: string[] = [];

  // Build a "known facts" block from non-null contact data
  known.push(`Full Name: ${contact.name}`);
  if (contact.firstName) known.push(`First Name: ${contact.firstName}`);
  if (contact.lastName) known.push(`Last Name: ${contact.lastName}`);
  if (contact.company) known.push(`Company: ${contact.company}`);
  if (contact.role) known.push(`Current Role: ${contact.role}`);
  if (contact.headline) known.push(`Headline: ${contact.headline}`);
  if (contact.location) known.push(`Location: ${contact.location}`);
  if (contact.industry) known.push(`Industry: ${contact.industry}`);
  if (contact.website) known.push(`Website: ${contact.website}`);
  if (contact.about) known.push(`Bio: ${contact.about}`);

  if (contact.emails?.length) {
    known.push(`Emails: ${contact.emails.map(e => e.email).join(', ')}`);
  }
  if (contact.socialLinks?.length) {
    known.push(`Social Profiles:\n${contact.socialLinks.map(s =>
      `  - ${s.platform}: ${s.url}`).join('\n')}`);
  }
  if (contact.experience?.length) {
    known.push(`Known Work History:\n${contact.experience.map(e =>
      `  - ${e.role || '?'} at ${e.company}${e.isCurrent ? ' (current)' : ''}`
    ).join('\n')}`);
  }
  if (contact.education?.length) {
    known.push(`Known Education:\n${contact.education.map(e =>
      `  - ${e.degree || 'Degree'} in ${e.fieldOfStudy || '?'} at ${e.school}`
    ).join('\n')}`);
  }

  // Build disambiguation search hints to anchor the model to the right person.
  // Common names (e.g. "David Kim") are ambiguous without company/role context.
  const searchHints: string[] = [];
  if (contact.name && contact.company) {
    searchHints.push(`  - "${contact.name} ${contact.company}"`);
  }
  if (contact.name && contact.role) {
    searchHints.push(`  - "${contact.name} ${contact.role}"`);
  }
  if (contact.name && contact.location) {
    searchHints.push(`  - "${contact.name} ${contact.location}"`);
  }
  // Email-domain hint: corporate email domains are high-signal for disambiguation
  if (contact.emails?.length) {
    const domain = contact.emails[0].email.split('@')[1];
    if (domain && !FREE_EMAIL_DOMAINS.has(domain.toLowerCase())) {
      searchHints.push(`  - "${contact.name} ${domain}"`);
    }
  }

  const searchHintsBlock = searchHints.length > 0
    ? `\n## Suggested Search Queries\nStart with these targeted queries to identify the correct person:\n${searchHints.join('\n')}`
    : '';

  return `
You are a professional researcher. Your task is to find accurate, publicly 
available information about the person described below.

CRITICAL RULES:
1. You MUST use Google Search to verify every piece of information you return.
2. Do NOT guess, infer, or hallucinate. If you cannot find a verifiable 
   source for any field, return null for that field.
3. Cross-reference multiple sources when possible.
4. For social links, return ONLY verified URLs that actually exist.
5. For interests, only include publicly stated interests or hobbies.
6. Mark ALL interests as isAiGenerated: true — this is mandatory.
7. For experience entries, set isCurrent: true only for current roles.
8. For experience entries, include startDate and endDate when available.
   Use approximate years like "2020" or "2018" if exact dates aren't known.
   If you cannot determine dates, omit startDate/endDate entirely — do NOT
   return the string "null".
9. IDENTITY VALIDATION: You MUST confirm this is the correct person (matching
   name AND company/role/location) before returning any data. If you find
   multiple people with this name and cannot determine which is correct,
   return null for all ambiguous fields.
10. CONFIDENCE THRESHOLD: Only return data you are at least 80% confident 
   about. For uncertain fields, return null rather than a best guess.
11. Do NOT fabricate LinkedIn URLs. LinkedIn profile URLs follow the pattern
    linkedin.com/in/[handle] — do NOT guess the handle if you cannot verify it.
12. Do NOT infer education from employment (e.g., "works at Stanford" ≠ 
    "studied at Stanford"). Only return education entries with direct source evidence.
13. If the known information is insufficient to identify a unique individual
    (e.g., name only, no company or location), return null for ALL fields rather
    than guessing which person with that name might be correct.
14. NEVER return the literal string "null" as a value. If a field is unknown,
    use a proper JSON null value, or omit the field entirely.

## What We Already Know

${known.join('\n')}
${searchHintsBlock}

## What To Search For

Find any additional information about this person that we don't already have.
Focus on: professional background, education history, social media profiles,
public contact information, industry expertise, and notable achievements.

Return a JSON object with ONLY the new information you found. Do not repeat
information we already have. Return null for fields you cannot verify.
  `.trim();
}

// =============================================================================
// Output Zod Schema (for Pass 2 validation)
// =============================================================================
// Uses Zod's default .strip() mode — silently drops unrecognized fields from
// LLM output while preserving all valid fields. This is more resilient than
// .strict() which rejects the entire response if one unexpected field appears.
// =============================================================================

export const aiSearchOutputSchema = z.object({
  headline: z.string().nullish(),
  about: z.string().nullish(),
  industry: z.string().nullish(),
  website: z.string().nullish(),
  location: z.string().nullish(),
  pronouns: z.string().nullish(),
  birthday: z.string().nullish(),
  emails: z.array(z.object({
    email: z.string(),
    label: z.string().optional(),
  })).optional(),
  phones: z.array(z.object({
    phone: z.string(),
    label: z.string().optional(),
  })).optional(),
  socialLinks: z.array(z.object({
    platform: z.string(),
    url: z.string(),
  })).optional(),
  education: z.array(z.object({
    school: z.string(),
    degree: z.string().optional(),
    fieldOfStudy: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })).optional(),
  experience: z.array(z.object({
    company: z.string(),
    role: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    isCurrent: z.boolean().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
  })).optional(),
  tags: z.array(z.object({
    tag: z.string(),
  })).optional(),
  interests: z.array(z.object({
    interest: z.string(),
    isAiGenerated: z.boolean().optional(),
  })).optional(),
  attributes: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })).optional(),
  addresses: z.array(z.object({
    address: z.string(),
    label: z.string().optional(),
  })).optional(),
});

export type AISearchOutput = z.infer<typeof aiSearchOutputSchema>;

// =============================================================================
// Gemini responseSchema (for Pass 2 structured output)
// =============================================================================
// This JsonSchemaNode tree is sent to Gemini as the responseSchema config.
// It mirrors the Zod schema above but in the provider-agnostic format that
// the GeminiAdapter translates to Gemini's native Type.* format.
// =============================================================================

export const extractionJsonSchema: JsonSchemaNode = {
  type: "object",
  properties: {
    headline: { type: "string", nullable: true },
    about: { type: "string", nullable: true },
    industry: { type: "string", nullable: true },
    website: { type: "string", nullable: true },
    location: { type: "string", nullable: true },
    pronouns: { type: "string", nullable: true },
    birthday: { type: "string", nullable: true },
    emails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          email: { type: "string" },
          label: { type: "string" },
        },
        required: ["email"],
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
        required: ["phone"],
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
        required: ["platform", "url"],
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
        required: ["school"],
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
        required: ["company"],
      },
    },
    tags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tag: { type: "string" },
        },
        required: ["tag"],
      },
    },
    interests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          interest: { type: "string" },
          isAiGenerated: { type: "boolean" },
        },
        required: ["interest"],
      },
    },
    attributes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          value: { type: "string" },
        },
        required: ["name", "value"],
      },
    },
    addresses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          address: { type: "string" },
          label: { type: "string" },
        },
        required: ["address"],
      },
    },
  },
};

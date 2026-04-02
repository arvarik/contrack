import "dotenv/config";
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "dummy_key" });

/**
 * Parses raw, unstructured text to extract contact fields accurately.
 * Returns a structured object compatible with the normalized schema —
 * emails, phones, socialLinks, education, experience are returned as
 * arrays that the server will insert into child tables.
 */
export async function parseContactRecord(text: string) {
  const prompt = `
    Extract contact information from the following unstructured text. 
    Map it to the structured schema reliably. If a field cannot be derived, omit it (leave it null/empty).
    For firstName and lastName, split from the full name if possible.
    For headline, extract a professional headline or tagline if present.
    For industry, extract the industry vertical if mentioned.
    For experience entries, try to determine if a role is current (isCurrent).
    For education entries, try to extract the field of study separately from degree.

    Text Payload:
    "${text}"
  `;

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing from environment. Cannot run Auto-Parser.");
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            firstName: { type: Type.STRING },
            lastName: { type: Type.STRING },
            headline: { type: Type.STRING },
            company: { type: Type.STRING },
            role: { type: Type.STRING },
            location: { type: Type.STRING },
            about: { type: Type.STRING },
            pronouns: { type: Type.STRING },
            industry: { type: Type.STRING },
            website: { type: Type.STRING },
            emails: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  email: { type: Type.STRING },
                  label: { type: Type.STRING },
                },
              },
            },
            phones: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  phone: { type: Type.STRING },
                  label: { type: Type.STRING },
                },
              },
            },
            socialLinks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  platform: { type: Type.STRING },
                  url: { type: Type.STRING },
                },
              },
            },
            education: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  school: { type: Type.STRING },
                  degree: { type: Type.STRING },
                  fieldOfStudy: { type: Type.STRING },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                },
              },
            },
            experience: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  company: { type: Type.STRING },
                  role: { type: Type.STRING },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  isCurrent: { type: Type.BOOLEAN },
                  description: { type: Type.STRING },
                  location: { type: Type.STRING },
                },
              },
            },
          },
          required: ["name"],
        },
      },
    });

    if (!response.text) {
        throw new Error("No text response from Gemini");
    }
    const parsed = JSON.parse(response.text);
    return parsed;
  } catch (error: any) {
    console.error("AI Parsing Failed:", error);
    throw error;
  }
}

/**
 * Feeds a contact profile and their last N interactions into Gemini to
 * generate an executive 3-bullet briefing. Enforces JSON array response.
 */
export async function generateCatchMeUpBriefing(contact: any, interactions: any[]) {
  const prompt = `
    You are an elite executive assistant setting up a brief for your principal before a meeting.
    Read the following contact profile and their recent timeline of interactions.
    
    Synthesize exactly three (3) highly legible, concise bullet points:
    1. Key context from what was last discussed explicitly.
    2. Open loops / actionable items unresolved from previous talks.
    3. One personalized, highly relational conversational icebreaker based on their profile or past notes.

    Return the result as a simple JSON array of 3 strings. DO NOT use markdown lists inside the strings.
    If there isn't enough interaction history to derive meaningful points, gracefully mention that 
    this is a relatively new or sparse contact, but always return exactly 3 robust string bullet points.

    Contact Profile:
    ${JSON.stringify(contact, null, 2)}

    Recent Timeline (Past 15):
    ${JSON.stringify(interactions, null, 2)}
  `;

  try {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy_key") {
      console.warn("Using mock AI Briefing due to missing GEMINI_API_KEY");
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      return [
        "Met at the Design Systems Conference last year; he expressed strong interest in component-driven architecture.",
        "Need to close the loop on the draft proposal for the new Nexus design system integration.",
        "Icebreaker: Ask how his studio in Copenhagen is holding up with the recent sudden weather shift!"
      ];
    }

    const start = Date.now();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
      },
    });

    if (!response.text) {
        throw new Error("No text response from Gemini");
    }
    const parsed = JSON.parse(response.text);
    
    // Robust Logging
    console.log(`[AI Briefing] Synthesized in ${Date.now() - start}ms | Tokens: ${response.usageMetadata?.totalTokenCount || '?'}`);
    
    return parsed as string[];
  } catch (error: any) {
    console.error("AI Briefing Failed:", error);
    throw error;
  }
}

/**
 * Examines a timeline note and extracts distinct person entities along with contextual mapping.
 * Driven via Gemini using structured JSON output schemas. Avoids the document author.
 */
export async function extractMentions(text: string) {
  const prompt = `
    Analyze the following timeline note. Identify any human person introduced or mentioned in the text who is distinct from the primary user writing the note.
    
    If you find any names:
    - Extract their name.
    - Extract any company/organization associated dynamically with them (if mentioned).
    - Provide a short 3-5 word context of how they were mentioned.
    
    Return exactly a JSON array of objects.
    Schema: [{ "name": "string", "company": "string | null", "context": "string" }]
    If nobody new is mentioned, return an empty array [].
    
    Timeline Note:
    "${text}"
  `;

  try {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy_key") {
      console.warn("Using mock AI Mentions due to missing GEMINI_API_KEY");
      // Simulate network delay and return empty or mock if helpful. Returning empty in dummy.
      await new Promise(resolve => setTimeout(resolve, 1500));
      return [];
    }

    const start = Date.now();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              company: { type: Type.STRING, nullable: true },
              context: { type: Type.STRING },
            },
            required: ["name", "context"],
          },
        },
      },
    });

    if (!response.text) {
        return [];
    }
    const parsed = JSON.parse(response.text);
    
    // Robust Logging
    console.log(`[AI Mentions] Extracted ${parsed.length} ghost entities in ${Date.now() - start}ms | Tokens: ${response.usageMetadata?.totalTokenCount || '?'}`);
    
    return parsed as { name: string, company?: string | null, context: string }[];
  } catch (error: any) {
    console.error("AI Mentions Extraction Failed:", error);
    return [];
  }
}

/**
 * Parses raw .eml strings into highly actionable, formatted HTML thread summaries.
 * Designed to strip Apple Mail export jargon organically.
 */
export async function summarizeEmlEmail(rawEml: string) {
  const prompt = `
    You are an expert executive assistant processing a raw .eml email export file.
    The user has exported an email thread and dropped it into the CRM.
    
    1. Parse the thread and identify the core subject, participants, and flow.
    2. Completely ignore and strip out all raw MIME boundaries, headers, legal disclaimers, signature blocks, and security scanning footers.
    3. Provide a highly legible, synthesized summary of the ACTUAL conversation thread. Do not just blindly copy the text. Distill it.
    4. Provide the final output as a clean HTML string. Use <ul>, <li>, <p>, and <strong> tags to make it ultra-readable inside a custom UI component pane. Do NOT wrap it in "html", "head", or "body" tags. Only return the inner content elements.
    
    Raw .EML text:
    "${rawEml}"
  `;

  try {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy_key") {
      console.warn("Using mock EML summary due to missing GEMINI_API_KEY");
      await new Promise(resolve => setTimeout(resolve, 1500));
      return "<p><strong>Re: Q3 Roadmap Planning</strong></p><p>Thread summary:</p><ul><li>Julian proposed pushing the V2 alpha back by two weeks.</li><li>Sarah agreed to coordinate with marketing.</li><li>John provided the final wireframe mocks for the reporting suite.</li></ul>";
    }

    const start = Date.now();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "text/plain",
      },
    });

    // Robust Logging
    console.log(`[AI EML Digest] Synchronously digested in ${Date.now() - start}ms | Tokens: ${response.usageMetadata?.totalTokenCount || '?'}`);

    return response.text || "<p>Email could not be parsed.</p>";
  } catch (error: any) {
    console.error("AI EML Summarization Failed:", error);
    return "<p><em>Error: Email string mapping structure breached context bounds.</em></p>";
  }
}

// =============================================================================
// Semantic RAG Contact Search
// =============================================================================

/**
 * Lightweight contact projection passed to Gemini for RAG context.
 * Nulls are stripped by the caller before passing here.
 */
export interface CompressedContact {
  id: string;
  name: string;
  role?: string;
  company?: string;
  location?: string;
  about?: string;
  industry?: string;
  preferences?: string;
  interests?: string; // denormalized from contact_tags
}

/**
 * A single match returned by Gemini from the semantic search.
 */
export interface SemanticMatchResult {
  contact_id: string;
  reason: string;
}

/**
 * Performs semantic RAG search over a compressed contact dump.
 *
 * Passes the user's natural-language query plus every active contact
 * (as a null-stripped compact JSON array) to Gemini, which acts as a
 * data analyst and returns the subset of contact IDs that match,
 * each paired with a one-sentence explanation.
 *
 * Token budget (approx): ~120 bytes / contact × 500 contacts = ~60 KB
 * ≈ 15,000 tokens — well within gemini-flash's 1M context window.
 *
 * @param query  The user's natural-language question (e.g. "Who likes espresso?")
 * @param contacts  Compressed, null-stripped contact dump from the DB
 * @returns Array of { contact_id, reason } matches, or [] if none found
 */
export async function semanticContactSearch(
  query: string,
  contacts: CompressedContact[]
): Promise<SemanticMatchResult[]> {
  // Mock path — no API key
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy_key") {
    console.warn("[AI Semantic] Using mock response due to missing GEMINI_API_KEY");
    await new Promise(resolve => setTimeout(resolve, 800));
    // Return first contact as mock match if any exist
    if (contacts.length > 0) {
      return [{ contact_id: contacts[0].id, reason: "Mock result: API key not configured." }];
    }
    return [];
  }

  const contextJson = JSON.stringify(contacts);

  const prompt = `
You are an expert CRM data analyst. You have been given a JSON array of contacts from a personal CRM database.
Each contact may have: id, name, role, company, location, about, industry, preferences, interests (tags).

Your task: Analyze the user's natural-language query and identify ALL contacts from the provided array that
meaningfully answer the question. Be thorough but precise — only include genuine matches.

For each match, provide a single concise sentence (max 15 words) explaining exactly why this specific
contact answers the query (reference specific data fields, e.g. "Listed espresso as a preference" or
"Works in FinTech at Barclays, London").

If no contacts match the query, return an empty array [].
Do NOT invent information not present in the data. Only cite what exists in the contact fields.

USER QUERY: "${query.replace(/"/g, "'")}"

CRM CONTACTS (${contacts.length} active, non-ghost):
${contextJson}
  `.trim();

  const start = Date.now();

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            contact_id: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ["contact_id", "reason"],
        },
      },
    },
  });

  if (!response.text) {
    return [];
  }

  const parsed: SemanticMatchResult[] = JSON.parse(response.text);
  const elapsed = Date.now() - start;
  const tokens = response.usageMetadata?.totalTokenCount ?? "?";

  console.log(
    `[AI Semantic] "${query}" → ${parsed.length} matches in ${elapsed}ms | Tokens: ${tokens} | Contacts scanned: ${contacts.length}`
  );

  return parsed;
}

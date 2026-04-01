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

import { GoogleGenAI, Type } from "@google/genai";
import { Contact, Interaction, AIInsight } from "../types";

// Initialize Gemini. 
// Note: If you want to use a local LLM like Ollama, you can swap out `GoogleGenAI` 
// with an OpenAI-compatible client pointed at `http://127.0.0.1:11434/v1`.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "dummy_key" });

/**
 * Generates an AI summary of a contact based on their interaction history.
 * Designed to cleanly handle missing API keys or network failures by returning 
 * a fallback object rather than crashing the React application.
 * 
 * @param contact The selected Contact object.
 * @param timeline Array of chronological interactions.
 * @returns AIInsight object with actionable intelligence.
 */
export async function generateContactInsights(contact: Contact, timeline: Interaction[]): Promise<AIInsight> {
  const prompt = `
    Based on the following contact information and interaction timeline, provide AI insights for our CRM.
    
    Contact:
    Name: ${contact.name}
    Role: ${contact.role}
    Company: ${contact.company}
    Preferences: ${contact.preferences}
    
    Interaction Timeline:
    ${timeline.map(n => `- [${n.type.toUpperCase()}] ${n.title}: ${n.content || 'No details provided.'}`).join('\n')}
    
    Identify:
    1. A recommended next contact date phrasing (e.g., "Follow up next Tuesday").
    2. A summary sentiment (e.g., "Highly Engaged", "Neutral", "Requires Immediate Attention").
    3. A brief description of the current relationship health and advice for the next interaction.
  `;

  try {
    if (!process.env.GEMINI_API_KEY) {
      console.warn("GEMINI_API_KEY is not set. Returning stub AI insight.");
      return {
        contactId: contact.id,
        nextRecommendedContact: "Set API Key to activate",
        summarySentiment: "Unknown",
        sentimentDescription: "No API key detected. Please configure GEMINI_API_KEY in your environment, or swap the LLM backend to Ollama for local execution.",
      };
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            nextRecommendedContact: { type: Type.STRING },
            summarySentiment: { type: Type.STRING },
            sentimentDescription: { type: Type.STRING },
          },
          required: ["nextRecommendedContact", "summarySentiment", "sentimentDescription"],
        },
      },
    });

    const text = response.text;
    const parsed = JSON.parse(text);
    return { ...parsed, contactId: contact.id };
  } catch (error: any) {
    console.error("AI Generation Failed:", error);
    return {
      contactId: contact.id,
      nextRecommendedContact: "Unable to determine",
      summarySentiment: "Error occurred",
      sentimentDescription: `The AI backend failed to process the request: ${error.message}`,
    };
  }
}

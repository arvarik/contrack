import { GoogleGenAI, Type } from "@google/genai";
import { Contact, Note, AIInsight } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateContactInsights(contact: Contact, notes: Note[]): Promise<AIInsight> {
  const prompt = `
    Based on the following contact information and notes, provide AI insights for "Contrack".
    
    Contact:
    Name: ${contact.name}
    Role: ${contact.role}
    Company: ${contact.company}
    Preferences: ${contact.preferences}
    
    Notes:
    ${notes.map(n => `- ${n.title}: ${n.content}`).join('\n')}
    
    Provide:
    1. A recommended next contact date (e.g., "October 24, 2023").
    2. A summary sentiment (e.g., "Highly Engaged", "Neutral", "Needs Attention").
    3. A brief description of the sentiment and advice for the next interaction.
  `;

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
  return JSON.parse(text);
}

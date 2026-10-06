// Model prices, for the usage page's cost estimate. Standard list prices in USD
// per 1M tokens, September 2026:
//   Gemini    https://ai.google.dev/gemini-api/docs/pricing
//   OpenAI    https://developers.openai.com/api/docs/pricing
//   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
//
// The usage log stores one token count per call, input and output together, so
// a call is priced at one blended rate: three parts input to one part output,
// close to Contrack's calls (a prompt with context, a short answer). The page
// says it is an estimate. A model not listed is priced at nothing rather than
// guessed.

interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  // Gemini. The 3.6 to 3.8 Flash price is Google's launch price, which runs
  // to December 31, 2026.
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },

  // OpenAI
  "gpt-6-astra": { input: 10.0, output: 50.0 },
  "gpt-6-sol": { input: 2.0, output: 10.0 },
  "gpt-6.1-sol": { input: 2.0, output: 10.0 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-5.6-sol": { input: 4.0, output: 20.0 },
  "gpt-5.6-terra": { input: 2.0, output: 12.0 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.4": { input: 2.5, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },

  // Anthropic
  "claude-fable-5-1": { input: 10.0, output: 50.0 },
  "claude-fable-5": { input: 10.0, output: 50.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-opus-4-5": { input: 5.0, output: 25.0 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

/** A dated snapshot suffix: -20251001, -2025-10-01. */
const SNAPSHOT = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** The list price for a model id, trying the id, then its undated alias. */
export function priceOf(modelId: string): Price | undefined {
  const id = modelId
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
  return PRICES[id] ?? PRICES[id.replace(SNAPSHOT, "")];
}

/**
 * One rate per 1M tokens for a call whose input and output are counted
 * together: three parts input to one part output. Zero for an unknown model.
 */
export function blendedCostPerM(modelId: string): number {
  const price = priceOf(modelId);
  if (!price) return 0;
  return (3 * price.input + price.output) / 4;
}

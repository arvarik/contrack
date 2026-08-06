// =============================================================================
// Provider contract tests — availability helpers
// =============================================================================
// These tests call real provider APIs. They exist because mocked adapter tests
// cannot catch the failure mode that matters here: a mock encodes *our*
// assumption about a provider's wire format, so when the assumption is wrong
// the test passes forever while the feature is broken. Anthropic's
// `output_config.format` shipped broken for exactly that reason — the unit
// test asserted the wrong shape and stayed green.
//
// Nothing here is required to develop Contrack. Every provider block skips
// itself when its credential is absent, so `npm run test:contract` with no keys
// configured reports all-skipped rather than failing, and a contributor with a
// single key exercises only that provider.
// =============================================================================

import "dotenv/config";

/** A credential that is present but a placeholder is not a credential. */
function realKey(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (value === "dummy_key" || /^(your|my)[-_]/i.test(value)) return null;
  if (/^MY_[A-Z_]+$/.test(value)) return null;
  return value;
}

export const geminiKey = () => realKey("GEMINI_API_KEY");
export const openaiKey = () => realKey("OPENAI_API_KEY");
export const anthropicKey = () => realKey("ANTHROPIC_API_KEY");

/**
 * An OpenAI-compatible endpoint to exercise, e.g.
 *   CONTRACT_COMPAT_URL=http://192.168.4.240:8082/v1
 *   CONTRACT_COMPAT_MODEL=/models/gemma-4-12B-it-Q5_K_M.gguf
 */
export const compatUrl = () => process.env.CONTRACT_COMPAT_URL?.trim() || null;
export const compatModel = () =>
  process.env.CONTRACT_COMPAT_MODEL?.trim() || null;

/** Optional per-provider model overrides, so a suite can pin a cheap model. */
export const modelFor = (provider: string, fallback: string) =>
  process.env[`CONTRACT_${provider.toUpperCase()}_MODEL`]?.trim() || fallback;

/** Embedding model to use when the provider supports embeddings. */
export const embedModelFor = (provider: string, fallback: string) =>
  process.env[`CONTRACT_${provider.toUpperCase()}_EMBED_MODEL`]?.trim() ||
  fallback;

/**
 * Real network calls to third parties are slow and occasionally flaky. Keep the
 * budget generous — a contract failure should mean "the contract changed", not
 * "the API was busy".
 */
export const CONTRACT_TIMEOUT_MS = 90_000;

/** A schema wide enough to be realistic but narrow enough to assert on. */
export const CONTACT_SCHEMA = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    company: { type: "string" as const },
    role: { type: "string" as const },
  },
  required: ["name"],
};

export const EXTRACTION_PROMPT =
  "Extract the contact from this text. " +
  "Text: Jane Doe is the CTO at Acme Robotics.";

/** Console banner so a skipped run explains itself rather than looking broken. */
export function announce(provider: string, reason: string): void {
  console.info(`[contract] skipping ${provider}: ${reason}`);
}

/** Does this message mean "your credential is no good" rather than "our code is"? */
function isCredentialProblem(message: string): boolean {
  return /401|403|invalid[_ ]?api[_ ]?key|incorrect api key|deactivated|unauthorized|permission|invalid x-api-key|api key not valid|expired/i.test(
    message,
  );
}

export interface CredentialStatus {
  usable: boolean;
  reason?: string;
}

/**
 * Decide whether a provider's credential is worth testing against.
 *
 * These tests exist to verify *our* adapters, not the reader's API keys — and
 * `OPENAI_API_KEY` in particular is commonly exported globally for unrelated
 * tools, so a stale one must not turn this suite red for someone who never
 * intended to test that provider. A credential rejected by the provider skips
 * with an explanation; anything else fails, because that is our bug.
 */
export async function probeCredential(
  provider: string,
  key: string | null,
  probe: () => Promise<unknown>,
): Promise<CredentialStatus> {
  if (!key) {
    const reason = `${provider.toUpperCase()}_API_KEY not set`;
    announce(provider, reason);
    return { usable: false, reason };
  }
  try {
    await probe();
    return { usable: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isCredentialProblem(message)) {
      const reason = `credential rejected by the provider — ${message.slice(0, 120)}`;
      announce(provider, reason);
      return { usable: false, reason };
    }
    // Not an auth problem: let the suite run so the real failure surfaces.
    return { usable: true };
  }
}

/**
 * Whether an AI feature has AI behind it, and if not, why and the page that
 * fixes it, read the way Settings reads it (`featureStatus`). An AI button
 * asks here first, so it waits and says why instead of failing with "Is your
 * API key configured?".
 */
import { useMemo } from "react";
import { useAISettings } from "../api/aiSettings";
import { useAuth } from "../components/auth/AuthGate";
import {
  AI_FEATURES,
  featureStatus,
  type FeatureState,
} from "../lib/aiFeatures";
import { useAiAllowed } from "./useAiAllowed";

/** Why AI cannot do the feature, and the page that fixes it, if this person can. */
export interface AiSetup {
  why: "account" | "instance" | "model";
  /**
   * `limited`: the feature still runs, with less (Ask answers from local
   * search). `off` and `setup`: it cannot run, so its button waits.
   */
  state: Exclude<FeatureState, "ready">;
  fix?: { label: string; path: string };
}

/**
 * The setup an AI feature lacks. Null while it is ready, and while the
 * settings load.
 *
 * @param featureId - An `AI_FEATURES` id: "ask", "briefings", "text", "research".
 * @param enabled - False skips the settings read, for a closed palette.
 */
export function useAiSetup(featureId: string, enabled = true): AiSetup | null {
  const aiAllowed = useAiAllowed();
  const { data: settings } = useAISettings({ enabled: enabled && aiAllowed });
  const { isAdmin } = useAuth();
  return useMemo((): AiSetup | null => {
    if (!aiAllowed) {
      return {
        why: "account",
        state: featureId === "ask" ? "limited" : "off",
        fix: {
          label: "Turn AI on in Settings → Privacy and AI",
          path: "/settings/privacy",
        },
      };
    }
    const feature = AI_FEATURES.find(({ id }) => id === featureId);
    // An answer without its instance block, such as an older server's,
    // leaves the buttons as they were.
    if (!settings?.instance || !feature) return null;
    const status = featureStatus(feature, settings, { accountAiOn: true });
    if (status.state === "ready") return null;
    // With no provider at all, a model cannot be chosen yet: connecting one
    // comes first, not "Choose a Fast model" with nothing to choose.
    const noProvider =
      settings.providers.length === 0 && settings.customEndpoints.length === 0;
    const fix =
      !settings.instance.aiOff && noProvider
        ? { label: "Connect a provider", anchor: "providers" }
        : status.fix;
    return {
      why: settings.instance.aiOff ? "instance" : "model",
      state: status.state,
      fix:
        isAdmin && fix
          ? {
              label: `${fix.label} in Settings → Administration → AI`,
              path: `/settings/admin/ai#${fix.anchor}`,
            }
          : undefined,
    };
  }, [aiAllowed, featureId, settings, isAdmin]);
}

/**
 * The setup an AI feature cannot run without, or null when it can run, in
 * full or with less. An AI button waits while this is set, and says why
 * (`AiSetupNote`).
 */
export function useBlockedAi(
  featureId: string,
  enabled = true,
): AiSetup | null {
  const setup = useAiSetup(featureId, enabled);
  return setup && setup.state !== "limited" ? setup : null;
}

/** The line about AI's state: what is off, and who can turn it on. */
const SETUP_WORDS: Record<AiSetup["why"], { state: string; ask: string }> = {
  account: { state: "AI is off for your account", ask: "" },
  instance: {
    state: "AI is off on this instance",
    ask: "Ask an admin to turn it on",
  },
  model: { state: "No AI model is set up", ask: "Ask an admin to set one up" },
};

/**
 * What is off, then what to do: "No AI model is set up. Ask an admin to
 * set one up". The fix's own link says what to do when there is one.
 */
export function aiSetupLine(setup: AiSetup): string {
  const words = SETUP_WORDS[setup.why];
  return [words.state, !setup.fix && words.ask].filter(Boolean).join(". ");
}

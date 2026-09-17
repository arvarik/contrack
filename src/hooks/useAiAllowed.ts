/**
 * useAiAllowed — whether AI assistance is enabled for this account.
 *
 * When false, the account has opted out of third-party model calls. AI
 * features (synthesis, enrichment, smart paste, briefings, insights)
 * are suppressed or replaced with static explanations.
 *
 * @module hooks/useAiAllowed
 */
import { usePreferences } from "../contexts/PreferencesContext";

export function useAiAllowed(): boolean {
  const { preferences } = usePreferences();
  return preferences.aiAssist ?? true;
}

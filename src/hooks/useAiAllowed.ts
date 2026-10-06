/**
 * Whether AI assistance is on for this account. When false, the account has
 * opted out of third-party model calls, and AI features (synthesis,
 * enrichment, smart paste, briefings, insights) are hidden or explain why.
 */
import { usePreferences } from "../contexts/PreferencesContext";

export function useAiAllowed(): boolean {
  const { preferences } = usePreferences();
  return preferences.aiAssist ?? true;
}

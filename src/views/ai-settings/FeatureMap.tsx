/**
 * "What each feature uses": every AI feature, whether it works now, and what
 * it runs on. Models are chosen by role, but people think by feature. It reads
 * the one feature table (`lib/aiFeatures`).
 *
 * - `scope="instance"` (Administration → AI): each part links to its control.
 * - `scope="account"` (Privacy and AI): this account's AI switch and engine,
 *   and no links. A member cannot change them, and an admin has the AI page.
 */
import { Link } from "react-router-dom";
import { useAISettings } from "../../api/aiSettings";
import { usePreferences } from "../../contexts/PreferencesContext";
import {
  AI_FEATURES,
  featureParts,
  featureStatus,
  ROLE_ANCHORS,
  STATE_WORDS,
  type FeatureState,
  type FeatureViewer,
} from "../../lib/aiFeatures";
import { TONE_WASH, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { TOUCH_LINK } from "../settings/layout";
import { TEXT_LINK } from "../../lib/styles";

const STATE_TONE: Record<FeatureState, Tone> = {
  ready: "success",
  limited: "warning",
  off: "neutral",
  setup: "warning",
};

export function FeatureMap({ scope }: { scope: "instance" | "account" }) {
  const { data: settings, isLoading } = useAISettings();
  const { preferences } = usePreferences();

  if (isLoading || !settings) {
    return (
      <ul
        aria-busy="true"
        aria-label="Loading AI features"
        className="space-y-2"
      >
        {AI_FEATURES.map((feature) => (
          <li
            key={feature.id}
            className="h-16 rounded-xl bg-surface-container-low animate-pulse"
          />
        ))}
      </ul>
    );
  }

  const links = scope === "instance";
  const viewer: FeatureViewer =
    scope === "account"
      ? {
          accountAiOn: preferences.aiAssist,
          engineChoice: preferences.webSearchEngine,
        }
      : {};
  const noProvider = settings.providers.length === 0;

  return (
    <div className="space-y-3">
      {noProvider && (
        <p className="text-sm text-on-surface-variant text-pretty">
          No AI provider is connected, so only the local features work.
          {links && (
            <>
              {" "}
              <Link to="#providers" className={cn(TEXT_LINK, TOUCH_LINK)}>
                Add a key
              </Link>
            </>
          )}
        </p>
      )}
      <ul className="divide-y divide-surface-container-high">
        {AI_FEATURES.map((feature) => {
          const status = featureStatus(feature, settings, viewer);
          const parts = featureParts(feature, settings, viewer);
          return (
            <li key={feature.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-on-surface">
                    {feature.name}
                  </p>
                  <p className="text-xs text-on-surface-variant text-pretty">
                    {feature.does}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded whitespace-nowrap",
                    TONE_WASH[STATE_TONE[status.state]],
                  )}
                >
                  {STATE_WORDS[status.state]}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-on-surface-variant flex flex-wrap gap-y-1">
                {parts.map((part, index) => (
                  <span key={part.role} title={part.does}>
                    {index > 0 && (
                      <span aria-hidden="true" className="px-1.5">
                        ·
                      </span>
                    )}
                    {links ? (
                      // Underlined, so the link does not rely on its color.
                      <Link
                        to={`#${ROLE_ANCHORS[part.role]}`}
                        className={cn(
                          "text-primary underline underline-offset-2",
                          TOUCH_LINK,
                        )}
                      >
                        {part.name}
                      </Link>
                    ) : (
                      part.name
                    )}
                    :{" "}
                    <span className="font-semibold text-on-surface">
                      {part.runs}
                    </span>
                  </span>
                ))}
              </p>
              {status.reason && (
                <p className="mt-1 text-xs text-on-surface-variant text-pretty">
                  {status.reason}
                  {links && status.fix && (
                    <>
                      {". "}
                      <Link
                        to={`#${status.fix.anchor}`}
                        className={cn(TEXT_LINK, TOUCH_LINK)}
                      >
                        {status.fix.label}
                      </Link>
                    </>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

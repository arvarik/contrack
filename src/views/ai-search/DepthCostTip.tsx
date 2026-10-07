/**
 * The question mark beside "Depth": what one contact costs at each depth on
 * Google, Claude and OpenAI, at 2026 list prices. The depth tiles price Gemini
 * alone, so this is where to compare providers. Google's figures were
 * measured. The others are estimates (`estimateCostUsd`).
 */
import {
  estimateCostUsd,
  RESEARCH_PRICES,
  RESEARCH_PROVIDERS,
  type ResearchProvider,
} from "../../../shared/researchDepth";
import { InfoTip } from "../../components/ui/InfoTip";
import { dollars } from "../../lib/researchDepth";

/** "$2" for a whole price, "$0.75" for the rest. */
const price = (amount: number): string =>
  Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

/** "$0.75 in, $3.75 out per 1M tokens. $14 per 1,000 searches", the last sentence without a period. */
function priceLine(provider: ResearchProvider): string {
  const p = RESEARCH_PRICES[provider];
  const line = `${price(p.inputPerM)} in, ${price(p.outputPerM)} out per 1M tokens. ${price(p.searchPer1000)} per 1,000 searches`;
  return p.freeSearchesPerMonth
    ? `${line} The first ${p.freeSearchesPerMonth.toLocaleString("en-US")} searches a month are free`
    : line;
}

export function DepthCostTip() {
  return (
    <InfoTip label="Estimated research costs" wide>
      <span className="block font-bold">
        Estimated cost per contact, 2026 prices
      </span>
      {RESEARCH_PROVIDERS.map((provider) => (
        <span key={provider} data-provider={provider} className="mt-2 block">
          <span className="block font-bold">
            {RESEARCH_PRICES[provider].providerLabel} ·{" "}
            {RESEARCH_PRICES[provider].modelLabel}
          </span>
          <span className="block tabular-nums">
            Standard {dollars(estimateCostUsd(provider, "standard"))} · Deep{" "}
            {dollars(estimateCostUsd(provider, "deep"))}
          </span>
          <span className="block">{priceLine(provider)}</span>
        </span>
      ))}
      <span className="mt-2 block">
        Google&apos;s figures were measured. The others are estimates from the
        same searches and tokens
      </span>
    </InfoTip>
  );
}

/**
 * AiView — Settings → Administration → AI.
 *
 * Renders AISettingsView: the instance switch, what each feature uses, the
 * providers, the models and web search. The shell's one scroller carries
 * it, header and all, so it has no scroller of its own.
 */
import { AISettingsView } from "../../ai-settings";

export const AiView = () => <AISettingsView />;

export default AiView;

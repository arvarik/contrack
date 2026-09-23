/**
 * AiProvidersView — the AI provider configuration page under Administration.
 *
 * Renders AISettingsView (provider keys, endpoints, and capabilities). The
 * shell's one scroller carries it, header and all, so it has no scroller of
 * its own.
 */
import React from "react";
import { AISettingsView } from "../../ai-settings";

export const AiProvidersView = () => <AISettingsView />;

export default AiProvidersView;

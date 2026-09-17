/**
 * AiProvidersView — the AI provider configuration page under Administration.
 *
 * Renders AISettingsView (provider keys, endpoints, and capabilities).
 */
import React from "react";
import { AISettingsView } from "../../ai-settings";

export const AiProvidersView = () => (
  <div className="overflow-y-auto h-full">
    <AISettingsView />
  </div>
);

export default AiProvidersView;

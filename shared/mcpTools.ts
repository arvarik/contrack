/**
 * shared/mcpTools.ts — Canonical list of MCP tools and 1-line descriptions.
 *
 * Shared across the server MCP registry, Settings page tools table,
 * and documentation so tool names and descriptions never drift.
 *
 * @module shared/mcpTools
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  readOnly: boolean;
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "search_people",
    description:
      "Search contacts by natural language query with optional facet filters (role, company, location, industry, tag, list).",
    readOnly: true,
  },
  {
    name: "get_contact",
    description:
      "Retrieve a contact's full profile by contact ID, with the relationship score explanation when the contact is tracked (isTracked). An untracked contact has no score.",
    readOnly: true,
  },
  {
    name: "list_contacts",
    description:
      "Page through contacts with optional filtering by role, company, industry, update timestamp, or tracked (true for the people the account keeps up with).",
    readOnly: true,
  },
  {
    name: "get_timeline",
    description:
      "Fetch the interaction history and timeline for a specific contact.",
    readOnly: true,
  },
  {
    name: "search_notes",
    description:
      "Search notes and interactions with keyword, date range, and interaction type filters.",
    readOnly: true,
  },
  {
    name: "list_action_items",
    description:
      "List pending follow-up action items filtered by urgency (overdue, today, week, all).",
    readOnly: true,
  },
  {
    name: "get_pulse",
    description:
      "Get the dashboard Pulse metrics, at-risk relationships, and upcoming follow-ups.",
    readOnly: true,
  },
  {
    name: "list_tags",
    description: "List all tags used across contacts in your network.",
    readOnly: true,
  },
  {
    name: "list_lists",
    description: "List all custom contact lists and their member counts.",
    readOnly: true,
  },
  {
    name: "create_contact",
    description:
      "Create a new contact in your CRM with profile and contact details.",
    readOnly: false,
  },
  {
    name: "update_contact",
    description:
      "Update fields on an existing contact profile, including isTracked (keep up with this person) and cadenceDays (how often).",
    readOnly: false,
  },
  {
    name: "log_interaction",
    description:
      "Log a meeting, call, email, or note with automatic mention extraction.",
    readOnly: false,
  },
  {
    name: "create_action_item",
    description:
      "Schedule a follow-up action item for a contact with a due date.",
    readOnly: false,
  },
  {
    name: "complete_action_item",
    description: "Mark a pending follow-up action item as completed.",
    readOnly: false,
  },
  {
    name: "add_to_list",
    description: "Add one or more contacts to a custom list.",
    readOnly: false,
  },
] as const;

export const MCP_TOOL_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, t.description]),
);

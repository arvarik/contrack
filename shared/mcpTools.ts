/**
 * shared/mcpTools.ts — Canonical list of MCP tools and 1-line descriptions.
 *
 * Shared across the server MCP registry, Settings page tools table,
 * and documentation so tool names and descriptions never drift.
 *
 * @module shared/mcpTools
 */

interface McpToolDefinition {
  name: string;
  description: string;
  readOnly: boolean;
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "search_people",
    description:
      "Search contacts with a question in plain words, and get up to 30 ranked matches. The role, company, location, industry, tag, and list filters narrow those matches. To find every contact with a field, use list_contacts.",
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
      "Page through contacts, newest first, with filters for role, company, location, industry, tag, list, email, phone, last update, and tracked. Email and phone match exactly, so they tell whether a person is already a contact.",
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
      "Get the dashboard Pulse metrics: the tracked contacts and their bands, the catch-ups past their cadence, and the follow-ups due.",
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
      "Create a contact with profile and contact details. It refuses an email or phone that a contact already has, and names that contact. Set allowDuplicate to create the contact anyway.",
    readOnly: false,
  },
  {
    name: "update_contact",
    description:
      "Change a contact's fields, including isTracked (keep up with this person) and cadenceDays (how often). Add or remove emails, phones, and tags, and the others stay.",
    readOnly: false,
  },
  {
    name: "log_interaction",
    description:
      "Log a meeting, call, email, or note that has happened. mentionContactIds links the other people in it. Without them, and with AI on, Contrack finds the people the text names.",
    readOnly: false,
  },
  {
    name: "create_action_item",
    description:
      "Schedule a follow-up action item for a contact with a due date.",
    readOnly: false,
  },
  {
    name: "update_action_item",
    description: "Change the title or the due date of a follow-up.",
    readOnly: false,
  },
  {
    name: "complete_action_item",
    description: "Mark a pending follow-up action item as completed.",
    readOnly: false,
  },
  {
    name: "create_list",
    description:
      "Create a list. It refuses a name that one of your lists already has.",
    readOnly: false,
  },
  {
    name: "add_to_list",
    description: "Add one or more contacts to a custom list.",
    readOnly: false,
  },
  {
    name: "remove_from_list",
    description: "Remove one or more contacts from a list.",
    readOnly: false,
  },
] as const;

export const MCP_TOOL_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, t.description]),
);

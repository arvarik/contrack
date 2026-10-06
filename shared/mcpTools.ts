/**
 * The one list of MCP tools: name, title, description and what each may
 * change. The server's registry, the Settings tools table and the docs read
 * it, so they cannot drift.
 */

/**
 * What a tool may change. `read` changes nothing. `add` adds or marks done
 * and removes nothing. `change` can overwrite or remove what is there, so a
 * client may ask the person first.
 */
export type McpToolEffect = "read" | "add" | "change";

export interface McpToolDefinition {
  name: string;
  /** A short name a client shows a person. */
  title: string;
  description: string;
  effect: McpToolEffect;
  /** A second identical call changes nothing more. */
  idempotent?: boolean;
}

export const MCP_TOOLS = [
  {
    name: "search_people",
    title: "Search people",
    description:
      "Search contacts with a question in plain words, and get up to 30 ranked matches. The role, company, location, industry, tag, and list filters narrow those matches. To find every contact with a field, use list_contacts.",
    effect: "read",
  },
  {
    name: "get_contact",
    title: "Get a contact",
    description:
      "Retrieve a contact's full profile by contact ID, with the relationship score explanation when the contact is tracked (isTracked). An untracked contact has no score.",
    effect: "read",
  },
  {
    name: "list_contacts",
    title: "List contacts",
    description:
      "Page through contacts, newest first, with filters for role, company, location, industry, tag, list, email, phone, last update, and tracked. Email and phone match exactly, so they tell whether a person is already a contact.",
    effect: "read",
  },
  {
    name: "get_timeline",
    title: "Get a timeline",
    description:
      "Page through a contact's notes, meetings, calls, and emails, newest first.",
    effect: "read",
  },
  {
    name: "search_notes",
    title: "Search notes",
    description:
      "Search notes and interactions with keyword, date range, and interaction type filters.",
    effect: "read",
  },
  {
    name: "list_action_items",
    title: "List follow-ups",
    description:
      "List pending follow-ups, soonest due first, filtered by urgency (overdue, today, week, all).",
    effect: "read",
  },
  {
    name: "get_pulse",
    title: "Get the Pulse",
    description:
      "Get the dashboard Pulse metrics: the tracked contacts and their bands, the catch-ups past their cadence, and the follow-ups due.",
    effect: "read",
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "List all tags used across contacts in your network.",
    effect: "read",
  },
  {
    name: "list_lists",
    title: "List lists",
    description: "List all custom contact lists and their member counts.",
    effect: "read",
  },
  {
    name: "create_contact",
    title: "Create a contact",
    description:
      "Create a contact with profile and contact details. It refuses an email or phone that a contact already has, and names that contact. Set allowDuplicate to create the contact anyway.",
    effect: "add",
  },
  {
    name: "update_contact",
    title: "Update a contact",
    description:
      "Change a contact's fields, including isTracked (keep up with this person) and cadenceDays (how often). Add or remove emails, phones, and tags, and the others stay.",
    effect: "change",
    idempotent: true,
  },
  {
    name: "log_interaction",
    title: "Log an interaction",
    description:
      "Log a meeting, call, email, or note that has happened. mentionContactIds links the other people in it. Without them, and with AI on, Contrack finds the people the text names.",
    effect: "add",
  },
  {
    name: "create_action_item",
    title: "Create a follow-up",
    description:
      "Schedule a follow-up action item for a contact with a due date.",
    effect: "add",
  },
  {
    name: "update_action_item",
    title: "Update a follow-up",
    description: "Change the title or the due date of a follow-up.",
    effect: "change",
    idempotent: true,
  },
  {
    name: "complete_action_item",
    title: "Complete a follow-up",
    description: "Mark a pending follow-up action item as completed.",
    effect: "add",
    idempotent: true,
  },
  {
    name: "create_list",
    title: "Create a list",
    description:
      "Create a list. It refuses a name that one of your lists already has.",
    effect: "add",
  },
  {
    name: "add_to_list",
    title: "Add to a list",
    description: "Add one or more contacts to a custom list.",
    effect: "add",
    idempotent: true,
  },
  {
    name: "remove_from_list",
    title: "Remove from a list",
    description: "Remove one or more contacts from a list.",
    effect: "change",
    idempotent: true,
  },
] as const satisfies readonly McpToolDefinition[];

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];

export const MCP_TOOL_BY_NAME: Record<McpToolName, McpToolDefinition> =
  Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool])) as Record<
    McpToolName,
    McpToolDefinition
  >;

/**
 * The MCP annotations of a tool. Every tool works on one account's data and
 * nothing outside it, so none is open-world. A client treats a write with
 * no hints as destructive, so each write says whether it only adds.
 */
export function mcpToolAnnotations(tool: McpToolDefinition) {
  if (tool.effect === "read") {
    return { title: tool.title, readOnlyHint: true, openWorldHint: false };
  }
  return {
    title: tool.title,
    readOnlyHint: false,
    destructiveHint: tool.effect === "change",
    idempotentHint: tool.idempotent === true,
    openWorldHint: false,
  };
}

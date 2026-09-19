/**
 * names.ts — one name per destination.
 *
 * The same page used to carry three names depending on where you met it:
 * "Ask AI" in the tab bar, "AI Search" in the sidebar and the palette, "Ask
 * Contrack" on the page itself. A person who learns a place by one label and
 * then looks for it under another is lost in their own app. Every surface that
 * names a destination reads it from here: the sidebar, the tab bar, the command
 * palette, the shortcuts dialog, document titles and the page headings.
 *
 *   label        the visible text and the accessible name of a link to it
 *   title        the document title while the page is open
 *   description  one plain sentence about what the page is for
 *
 * @module lib/names
 */

export interface DestinationName {
  label: string;
  title: string;
  description: string;
}

export const NAMES = {
  network: {
    label: "Network",
    title: "Network",
    description: "Everyone you keep in touch with.",
  },
  pulse: {
    label: "Pulse",
    title: "Pulse",
    description: "Follow-ups that are due and relationships that need you.",
  },
  map: {
    label: "Map",
    title: "Map",
    description: "Your network by where people live and work.",
  },
  ask: {
    label: "Ask Contrack",
    title: "Ask Contrack",
    description: "Ask a question about your network in plain words",
  },
  settings: {
    label: "Settings",
    title: "Settings",
    description: "Your preferences, your data and this instance.",
  },
  duplicates: {
    label: "Duplicates",
    title: "Duplicates",
    description: "Find and merge contacts that are the same person.",
  },
  possibleDuplicates: {
    label: "Possible duplicates",
    title: "Possible duplicates",
    description: "Pairs that may be the same person, waiting for a decision.",
  },
  enrichment: {
    label: "Contact enrichment",
    title: "Contact enrichment",
    description: "Research contacts on the web to fill in missing details.",
  },
  outgoingMail: {
    label: "Outgoing mail",
    title: "Outgoing mail",
    description: "The mail server that sends invitations and password resets.",
  },
  mcp: {
    label: "MCP and API",
    title: "MCP and API",
    description: "Let Claude, Cursor and scripts use your CRM.",
  },
  connectors: {
    label: "Connectors",
    title: "Connectors",
    description: "Calendar, mailbox, Google, messages. Sync who you talk to.",
  },
  correspondents: {
    label: "Correspondents",
    title: "Correspondents",
    description: "People you talk to who are not in Contrack yet.",
  },
} as const satisfies Record<string, DestinationName>;

export type DestinationKey = keyof typeof NAMES;

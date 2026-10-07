/**
 * One name per destination, so a page is called the same in the sidebar,
 * the tab bar, the palette, the shortcuts dialog, the document title and its
 * heading.
 *
 *   label        the visible text and the accessible name of a link to it
 *   title        the document title while the page is open
 *   description  one plain sentence about what the page is for
 */

interface DestinationName {
  label: string;
  title: string;
  description: string;
}

export const NAMES = {
  network: {
    label: "Network",
    title: "Network",
    description: "Everyone you keep in touch with",
  },
  pulse: {
    label: "Pulse",
    title: "Pulse",
    description: "Follow-ups that are due and relationships that need you",
  },
  map: {
    label: "Map",
    title: "Map",
    description: "Your network by where people live and work",
  },
  ask: {
    label: "Ask Contrack",
    title: "Ask Contrack",
    description: "Ask a question about your network in plain words",
  },
  settings: {
    label: "Settings",
    title: "Settings",
    description: "Your preferences, your data and this instance",
  },
  duplicates: {
    label: "Duplicates",
    title: "Duplicates",
    description: "Find and merge contacts that are the same person",
  },
  possibleDuplicates: {
    label: "Possible duplicates",
    title: "Possible duplicates",
    description: "Contacts that may be the same person, waiting for a decision",
  },
  mergeHistory: {
    label: "Merge history",
    title: "Merge history",
    description: "Recent merges, each with Undo for 90 days",
  },
  enrichment: {
    label: "Contact enrichment",
    title: "Contact enrichment",
    description: "Research contacts on the web to fill in missing details",
  },
  outgoingMail: {
    label: "Outgoing mail",
    title: "Outgoing mail",
    description: "The mail server that sends invitations and password resets",
  },
  mcp: {
    label: "MCP and API",
    title: "MCP and API",
    description: "Let Claude, Cursor and scripts use your CRM",
  },
  connectors: {
    label: "Connectors",
    title: "Connectors",
    description: "Calendar, mailbox and Google. Sync who you talk to",
  },
  correspondents: {
    label: "Correspondents",
    title: "Correspondents",
    description: "People you talk to who are not in Contrack yet",
  },
  tracked: {
    label: "Tracked contacts",
    title: "Tracked contacts",
    description: "Who you keep up with, and who you don't",
  },
} as const satisfies Record<string, DestinationName>;

/**
 * The sentence under the Tracked contacts heading, and the body of the empty
 * states of the Keeping up card and the Network list's Tracked filter. One
 * sentence, said the same in every place.
 */
export const TRACKED_INTRO =
  "Track the people you want to keep up with. Their score and their catch-ups follow";

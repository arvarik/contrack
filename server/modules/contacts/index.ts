// =============================================================================
// Module: contacts
// =============================================================================
// Contacts: the list, the profile, bulk edits, tracking, photos and pins.
//
// Its subscribers are the reactions to a contact write: the search index,
// the dedupe vector and the duplicate check, the geocoder, the score, the
// owner's caches and auto-enrichment (server/events/contactSubscribers.ts).
// Its jobs are the relationship score sweeps.
// =============================================================================

import { defineModule } from "../module.ts";
import { contactsRouter } from "../../routes/contacts.ts";
import { registerContactTools } from "../../mcp/tools/contacts.ts";
import { CONTACT_SUBSCRIBERS } from "../../events/contactSubscribers.ts";
import { SCORING_JOBS } from "../../jobs/scoring.ts";

export const contactsModule = defineModule({
  id: "contacts",
  routers: [{ path: "/api", router: contactsRouter }],
  mcpTools: [registerContactTools],
  subscribers: CONTACT_SUBSCRIBERS,
  jobs: SCORING_JOBS,
});

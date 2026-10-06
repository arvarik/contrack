/**
 * MCP resources: contrack://pulse (the dashboard payload) and
 * contrack://contacts/{id} (the profile and its score explanation).
 *
 * @module server/mcp/resources
 */

import {
  type McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../tenancy/scope.ts";
import { contactService } from "../services/contactService.ts";
import { relationshipService } from "../services/relationshipService.ts";
import { dashboardService } from "../services/dashboardService.ts";
import { NotFoundError } from "../utils/AppError.ts";
import { toMcpError } from "./errors.ts";
import { contactProfile, lean } from "./views.ts";

export function registerResources(server: McpServer, scope: Scope): void {
  server.resource(
    "pulse",
    "contrack://pulse",
    {
      description:
        "The dashboard Pulse payload including network metrics, at-risk contacts, and follow-ups",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const pulse = dashboardService.getDashboardPayload(scope);
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(lean(pulse), null, 2),
              mimeType: "application/json",
            },
          ],
        };
      } catch (err) {
        throw toMcpError(err, "resource");
      }
    },
  );

  server.resource(
    "contact",
    new ResourceTemplate("contrack://contacts/{id}", { list: undefined }),
    {
      description: "Full JSON profile and score explanation for a contact",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      try {
        const contactId = String(id);
        const contact = contactService.getContactById(scope, contactId);
        if (!contact) {
          throw new NotFoundError("Contact", contactId);
        }
        const scoreExplanation = relationshipService.explainScore(contactId);
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                { ...contactProfile(contact), scoreExplanation },
                null,
                2,
              ),
              mimeType: "application/json",
            },
          ],
        };
      } catch (err) {
        throw toMcpError(err, "resource");
      }
    },
  );
}

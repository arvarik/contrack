/** The consent page's two calls (server/routes/oauth.ts). */

import { apiJson, jsonBody } from "./client";
import { oauthRoutes } from "../../shared/contracts/oauth";

const requestPath = (id: string) =>
  `/auth/oauth/requests/${encodeURIComponent(id)}`;

/** A sign-in waiting for this person's answer. */
export function fetchConsentRequest(id: string) {
  return apiJson(oauthRoutes.request, requestPath(id));
}

/** Allow or deny it. The answer is where the browser goes next. */
export function decideConsent(
  id: string,
  decision: "allow" | "deny",
  access: "read" | "write",
) {
  return apiJson(
    oauthRoutes.decide,
    requestPath(id),
    jsonBody({ decision, access }),
  );
}

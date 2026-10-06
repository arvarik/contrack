// Contracts: OAuth sign-in for MCP clients
// The metadata documents and the four protocol endpoints that MCP clients
// call (server/routes/oauth.ts), and the consent page's two calls. The
// protocol endpoints answer in OAuth's own words (RFC 6749, 7591, 8414,
// 9728), so their field names are snake_case.

import { z } from "zod";
import { route } from "./route.ts";

const scopes = z.array(z.enum(["contrack:read", "contrack:write"]));

const protectedResourceSchema = z.strictObject({
  resource: z.string(),
  authorization_servers: z.array(z.string()),
  scopes_supported: scopes,
  bearer_methods_supported: z.array(z.literal("header")),
  resource_name: z.string(),
});

const tokenSchema = z.strictObject({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int(),
  refresh_token: z.string(),
  scope: z.string(),
});

const consentRequestSchema = z
  .strictObject({
    id: z.string(),
    client: z.strictObject({
      name: z.string(),
      /** The host that serves the app's metadata document, or null. */
      host: z.string().nullable(),
      /** True when the app is known by its document's host. */
      verified: z.boolean(),
    }),
    redirect: z.strictObject({
      host: z.string(),
      kind: z.enum(["web", "loopback", "app"]),
    }),
    /** The app asked for write access, so the page may offer it. */
    canWrite: z.boolean(),
    expiresAt: z.string(),
  })
  .meta({ id: "OAuthConsentRequest" });

export const oauthRoutes = {
  protectedResource: route({
    method: "GET",
    path: "/.well-known/oauth-protected-resource/api/mcp",
    summary:
      "The MCP endpoint's protected resource metadata (RFC 9728). 404 while OAuth is off",
    response: protectedResourceSchema,
  }),
  protectedResourceRoot: route({
    method: "GET",
    path: "/.well-known/oauth-protected-resource",
    summary: "The same metadata at the root path",
    response: protectedResourceSchema,
  }),
  authorizationServer: route({
    method: "GET",
    path: "/.well-known/oauth-authorization-server",
    summary: "The authorization server metadata (RFC 8414)",
    response: z.strictObject({
      issuer: z.string(),
      authorization_endpoint: z.string(),
      token_endpoint: z.string(),
      registration_endpoint: z.string(),
      revocation_endpoint: z.string(),
      response_types_supported: z.array(z.literal("code")),
      response_modes_supported: z.array(z.literal("query")),
      grant_types_supported: z.array(z.string()),
      code_challenge_methods_supported: z.array(z.literal("S256")),
      token_endpoint_auth_methods_supported: z.array(z.literal("none")),
      revocation_endpoint_auth_methods_supported: z.array(z.literal("none")),
      scopes_supported: scopes,
      client_id_metadata_document_supported: z.literal(true),
      authorization_response_iss_parameter_supported: z.literal(true),
    }),
  }),
  authorize: route({
    method: "GET",
    path: "/oauth/authorize",
    summary:
      "Start a sign-in. Answers 303 to the consent page, or to the client with an error",
    status: 303,
    response: z.null(),
  }),
  token: route({
    method: "POST",
    path: "/oauth/token",
    summary:
      "Trade a code, or rotate a refresh token. A form body, as OAuth sends it",
    response: tokenSchema,
  }),
  register: route({
    method: "POST",
    path: "/oauth/register",
    summary: "Register a public client (RFC 7591). Unused, it goes after a day",
    status: 201,
    response: z.strictObject({
      client_id: z.string(),
      client_id_issued_at: z.number().int(),
      client_name: z.string(),
      redirect_uris: z.array(z.string()),
      grant_types: z.array(z.string()),
      response_types: z.array(z.string()),
      token_endpoint_auth_method: z.literal("none"),
    }),
  }),
  revoke: route({
    method: "POST",
    path: "/oauth/revoke",
    summary: "Give a token back (RFC 7009). Its whole grant ends",
    response: z.strictObject({}),
  }),
  request: route({
    method: "GET",
    path: "/api/auth/oauth/requests/:id",
    summary: "A sign-in waiting for the person's answer, for the consent page",
    response: consentRequestSchema,
  }),
  decide: route({
    method: "POST",
    path: "/api/auth/oauth/requests/:id",
    summary:
      "Allow or deny a sign-in. Answers the address the browser goes to next",
    body: z.object({
      decision: z.enum(["allow", "deny"]),
      access: z.enum(["read", "write"]).optional(),
    }),
    response: z.strictObject({ redirectTo: z.string() }),
  }),
};

export type OAuthConsentRequest = z.infer<typeof consentRequestSchema>;

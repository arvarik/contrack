// Contracts: personal API tokens
// An account's own machine credentials, under /api/auth/tokens. Only a
// browser session reaches these routes, so a token cannot mint another one
// or revoke itself.

import { z } from "zod";
import { route } from "./route.ts";

/** Body for POST /api/auth/tokens. */
const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
  readOnly: z.boolean().optional(),
});

const apiTokenSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    /** The first 12 characters, which a list can show without leaking it. */
    tokenPrefix: z.string(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    /** True for a token that may only read. */
    readOnly: z.boolean(),
    /**
     * `personal` for a token the person made. `oauth` for an app they
     * approved, whose `tokenPrefix` is the host it signs in from.
     */
    kind: z.enum(["personal", "oauth"]),
  })
  .meta({ id: "ApiToken" });

const createdTokenSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  /** The plaintext. This answer is the only place it ever appears. */
  token: z.string(),
  tokenPrefix: z.string(),
  expiresAt: z.string().nullable(),
  readOnly: z.boolean(),
});

export const tokenRoutes = {
  list: route({
    method: "GET",
    path: "/api/auth/tokens",
    summary:
      "The account's tokens, newest first, revoked and expired ones included",
    response: z.strictObject({ tokens: z.array(apiTokenSchema) }),
  }),
  create: route({
    method: "POST",
    path: "/api/auth/tokens",
    summary: "Mint a token. The plaintext is in this answer and nowhere else",
    status: 201,
    body: tokenCreateSchema,
    response: createdTokenSchema,
  }),
  revoke: route({
    method: "DELETE",
    path: "/api/auth/tokens/:id",
    summary: "Stop a token working. Its row stays, for its owner to see",
    response: z.strictObject({ revoked: z.literal(true) }),
  }),
};

export type ApiToken = z.infer<typeof apiTokenSchema>;
export type CreatedApiToken = z.infer<typeof createdTokenSchema>;

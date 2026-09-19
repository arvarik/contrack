/**
 * server/routes/connectors.ts — REST endpoints for connector lifecycle, testing and sync.
 *
 * Mounted at `/api/connectors`.
 * Mutation endpoints require a user session (requireSession) so that personal
 * API tokens cannot configure or modify external credentials.
 *
 * @module server/routes/connectors
 */

import crypto from "node:crypto";
import { google } from "googleapis";
import { Router } from "express";
import { z } from "zod";
import { sqlite } from "../db.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validateBody } from "../utils/validators.ts";
import { requireSession } from "../middleware/auth.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { log } from "../utils/logger.ts";
import { AppError } from "../utils/AppError.ts";
import * as secretBox from "../utils/secretBox.ts";
import { publicOrigin } from "../utils/publicOrigin.ts";
import { isDocker, kindsFor } from "../connectors/registry.ts";
import { getGoogleOAuthCredentials } from "../services/integrationSettings.ts";
import type { GoogleSecret } from "../connectors/adapters/google.ts";
import {
  createConnector,
  deleteConnector,
  getConnector,
  ignoreCorrespondent,
  listConnectors,
  listCorrespondents,
  listRuns,
  runNow,
  testConnector,
  updateConnector,
} from "../connectors/service.ts";

export const connectorsRouter = Router();

// ── GET /kinds ─────────────────────────────────────────────────────────────
// Returns available connector kinds based on the host platform and containerization.
connectorsRouter.get(
  "/kinds",
  asyncHandler(async (req, res) => {
    const platform = process.platform;
    const docker = isDocker();
    const googleConfigured = Boolean(getGoogleOAuthCredentials());
    const kinds = kindsFor(platform, docker, { googleConfigured });
    res.json({ platform, docker, kinds });
  }),
);

// ── GET / ──────────────────────────────────────────────────────────────────
// Lists all connectors owned by the caller (never includes raw secrets).
connectorsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const connectors = listConnectors(scope);
    res.json({ connectors });
  }),
);

// ── POST / ─────────────────────────────────────────────────────────────────
// Creates a new connector after proving credentials via adapter.test.
const createConnectorSchema = z.object({
  kind: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  config: z.record(z.string(), z.unknown()),
  secret: z.unknown().optional(),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
});

connectorsRouter.post(
  "/",
  requireSession,
  validateBody(createConnectorSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const rid = req.requestId;
    const created = await createConnector(scope, req.body, req.ip ?? null);
    log.info(
      "Connectors",
      `[${rid}] POST /api/connectors → "${created.name}" (${created.id})`,
    );
    res.status(201).json(created);
  }),
);

// ── POST /test ─────────────────────────────────────────────────────────────
// Proves credentials with the adapter without persisting anything.
const testConnectorSchema = z.object({
  kind: z.string().trim().min(1),
  config: z.record(z.string(), z.unknown()),
  secret: z.unknown().optional(),
});

connectorsRouter.post(
  "/test",
  requireSession,
  validateBody(testConnectorSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const result = await testConnector(
      scope,
      req.body.kind,
      req.body.config,
      req.body.secret,
    );
    res.json(result);
  }),
);

// ── GET /correspondents ────────────────────────────────────────────────────
// Lists unknown people seen by connectors who are not contacts yet.
connectorsRouter.get(
  "/correspondents",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const limit = req.query.limit
      ? Math.min(Math.max(1, parseInt(String(req.query.limit), 10) || 50), 100)
      : 50;
    const correspondents = listCorrespondents(scope, limit);
    res.json({ correspondents });
  }),
);

// ── POST /correspondents/ignore ────────────────────────────────────────────
// Marks a correspondent as ignored so they do not become a ghost contact.
const ignoreCorrespondentSchema = z.object({
  connectorId: z.string().min(1, "connectorId is required"),
  externalId: z.string().min(1, "externalId is required"),
});

connectorsRouter.post(
  "/correspondents/ignore",
  requireSession,
  validateBody(ignoreCorrespondentSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const updated = ignoreCorrespondent(
      scope,
      req.body.connectorId,
      req.body.externalId,
    );
    res.json({ ok: true, updated });
  }),
);

// ── GET /google/start ──────────────────────────────────────────────────────
// Initiates Google OAuth authorization with PKCE.
connectorsRouter.get(
  "/google/start",
  requireSession,
  asyncHandler(async (req, res) => {
    const creds = getGoogleOAuthCredentials();
    if (!creds) {
      throw new AppError("Google OAuth client is not configured", 400, {
        code: "GOOGLE_NOT_CONFIGURED",
      });
    }

    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const state = crypto.randomUUID();

    sqlite
      .prepare(
        `INSERT INTO oauth_states (state, ownerId, kind, codeVerifier, createdAt)
         VALUES (?, ?, 'google', ?, CURRENT_TIMESTAMP)`,
      )
      .run(state, req.principal!.user.id, codeVerifier);

    const redirectUri = `${publicOrigin(req)}/api/connectors/google/callback`;
    const wantSummaries = req.query.summaries === "true";

    const scopes = [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      wantSummaries
        ? "https://www.googleapis.com/auth/gmail.readonly"
        : "https://www.googleapis.com/auth/gmail.metadata",
    ];

    const oauth2Client = new google.auth.OAuth2(
      creds.clientId,
      creds.clientSecret,
      redirectUri,
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- googleapis GenerateAuthUrlOpts type mismatch
      code_challenge_method: "S256" as any,
    });

    res.redirect(authUrl);
  }),
);

// ── GET /google/callback ───────────────────────────────────────────────────
// Handles the redirect back from Google OAuth consent screen.
connectorsRouter.get(
  "/google/callback",
  requireSession,
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (error) {
      return res.redirect(
        `/settings/connectors?error=${encodeURIComponent(error)}`,
      );
    }

    if (!code || !state) {
      throw new AppError("Missing OAuth code or state", 400, {
        code: "INVALID_STATE",
      });
    }

    const stateRow = sqlite
      .prepare("SELECT * FROM oauth_states WHERE state = ?")
      .get(state) as
      | {
          state: string;
          ownerId: string;
          kind: string;
          codeVerifier: string;
          createdAt: string;
        }
      | undefined;

    if (!stateRow) {
      throw new AppError("Invalid or expired OAuth state", 400, {
        code: "INVALID_STATE",
      });
    }

    // Immediately consume the state
    sqlite.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

    if (stateRow.ownerId !== req.principal!.user.id) {
      throw new AppError("OAuth state owner mismatch", 403, {
        code: "FORBIDDEN",
      });
    }

    const ageMs = Date.now() - new Date(stateRow.createdAt).getTime();
    if (ageMs > 15 * 60 * 1000) {
      throw new AppError("OAuth state has expired", 400, {
        code: "EXPIRED_STATE",
      });
    }

    const creds = getGoogleOAuthCredentials();
    if (!creds) {
      throw new AppError("Google OAuth client is not configured", 500);
    }

    const redirectUri = `${publicOrigin(req)}/api/connectors/google/callback`;
    const oauth2Client = new google.auth.OAuth2(
      creds.clientId,
      creds.clientSecret,
      redirectUri,
    );

    let tokens;
    try {
      const tokenRes = await oauth2Client.getToken({
        code,
        codeVerifier: stateRow.codeVerifier,
      });
      tokens = tokenRes.tokens;
      oauth2Client.setCredentials(tokens);
    } catch (tokenErr: unknown) {
      log.error("Connectors", "Google token exchange failed", {
        error: tokenErr,
      });
      return res.redirect(
        `/settings/connectors?error=${encodeURIComponent((tokenErr as Error).message)}`,
      );
    }

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    let userEmail: string | undefined;
    try {
      const userInfoRes = await oauth2.userinfo.get();
      userEmail = userInfoRes.data.email || undefined;
    } catch (userErr) {
      log.warn("Connectors", "Could not fetch user email in Google callback", {
        error: userErr,
      });
    }

    const scope = scopeOf(req);
    const existing = listConnectors(scope).find((c) => c.kind === "google");
    const hasGmailReadonly = (tokens.scope || "").includes("gmail.readonly");

    if (existing) {
      const nextSecret: GoogleSecret = {
        refreshToken: tokens.refresh_token || "",
        accessToken: tokens.access_token || undefined,
        expiryDate: tokens.expiry_date || undefined,
        email: userEmail,
      };

      if (!nextSecret.refreshToken) {
        const row = sqlite
          .prepare("SELECT secret FROM connectors WHERE id = ? AND ownerId = ?")
          .get(existing.id, scope.ownerId) as
          { secret: string | null } | undefined;
        if (row?.secret) {
          try {
            const opened = JSON.parse(secretBox.open(row.secret));
            nextSecret.refreshToken = opened.refreshToken;
          } catch {
            // ignore
          }
        }
      }

      await updateConnector(
        scope,
        existing.id,
        {
          status: "active",
          secret: nextSecret,
          config: {
            ...(existing.config as Record<string, unknown>),
            summaries: hasGmailReadonly,
          },
        },
        req.ip,
      );
    } else {
      await createConnector(
        scope,
        {
          kind: "google",
          name: userEmail ? `Google (${userEmail})` : "Google Workspace",
          config: {
            syncContacts: true,
            syncEmail: true,
            syncCalendar: true,
            summaries: hasGmailReadonly,
            lookbackDays: 90,
            rollup: true,
            ghostThreshold: 3,
            maxMessagesPerRun: 5000,
            aliases: [],
          },
          secret: {
            refreshToken: tokens.refresh_token || "",
            accessToken: tokens.access_token || undefined,
            expiryDate: tokens.expiry_date || undefined,
            email: userEmail,
          },
          intervalMinutes: 30,
        },
        req.ip,
      );
    }

    res.redirect("/settings/connectors?connected=google");
  }),
);

// ── GET /:id ───────────────────────────────────────────────────────────────
// Returns connector detail including recent run history.
connectorsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const connector = getConnector(scope, String(req.params.id));
    if (!connector) {
      throw new AppError("Connector not found", 404);
    }
    res.json(connector);
  }),
);

// ── PATCH /:id ─────────────────────────────────────────────────────────────
// Updates connector name, config, secret, intervalMinutes, or status.
const updateConnectorSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secret: z.unknown().optional(),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

connectorsRouter.patch(
  "/:id",
  requireSession,
  validateBody(updateConnectorSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const updated = await updateConnector(
      scope,
      String(req.params.id),
      req.body,
      req.ip ?? null,
    );
    res.json(updated);
  }),
);

// ── DELETE /:id ────────────────────────────────────────────────────────────
// Removes a connector. When deleteImported is true, also removes interactions
// and ghost contacts created by this connector.
connectorsRouter.delete(
  "/:id",
  requireSession,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const deleteImported =
      req.body?.deleteImported === true || req.query?.deleteImported === "true";
    await deleteConnector(
      scope,
      String(req.params.id),
      { deleteImported },
      req.ip ?? null,
    );
    res.status(204).end();
  }),
);

// ── POST /:id/sync ─────────────────────────────────────────────────────────
// Triggers an immediate sync run. Runs synchronously if background jobs are disabled.
connectorsRouter.post(
  "/:id/sync",
  requireSession,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const id = String(req.params.id);

    // Verify connector exists and is owned by caller
    const existing = getConnector(scope, id);
    if (!existing) {
      throw new AppError("Connector not found", 404);
    }

    if (process.env.DISABLE_BACKGROUND_JOBS === "true") {
      const result = await runNow(scope, id, "manual");
      res.status(202).json({ runId: result.runId });
    } else {
      // Run in background and return 202 immediately
      const runPromise = runNow(scope, id, "manual");
      // Prevent unhandled rejection
      runPromise.catch((err) =>
        log.error("Connectors", `Background sync failed for connector ${id}`, {
          error: err,
        }),
      );
      // Wait a tick for runNow to create the run row so runId is known
      const runId = await Promise.race([
        runPromise.then((r) => r.runId),
        new Promise<string>((resolve) => setTimeout(resolve, 50)).then(() => {
          const runs = listRuns(scope, id, 1);
          return runs[0]?.id ?? "run-queued";
        }),
      ]);
      res.status(202).json({ runId });
    }
  }),
);

// ── GET /:id/runs ──────────────────────────────────────────────────────────
// Returns run history for a specific connector.
connectorsRouter.get(
  "/:id/runs",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const limit = req.query.limit
      ? Math.min(Math.max(1, parseInt(String(req.query.limit), 10) || 20), 100)
      : 20;
    const runs = listRuns(scope, String(req.params.id), limit);
    res.json({ runs });
  }),
);

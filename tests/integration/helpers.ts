// =============================================================================
// Integration helpers — real app, real database
// =============================================================================
// Importing this module pulls in server/app.ts → server/db.ts, which opens a
// real SQLite database inside the temp DATA_DIR created by
// tests/integration-setup.ts (migrations, FTS index, triggers, and indexes
// all run for real).
// =============================================================================

import http from "http";
import type { Express, Response } from "express";
import { afterAll, afterEach } from "vitest";
import { z } from "zod";
import { createApp, finalizeApp, notFoundHandler } from "../../server/app.ts";
import { sqlite } from "../../server/db.ts";
import { contractFor, routeKey } from "../../shared/contracts/index.ts";
import {
  research,
  toAISearchResult,
  type ResearchRequest,
} from "../../server/services/research/index.ts";
import type { AISearchResult } from "../../server/services/aiSearch/types.ts";

// =============================================================================
// The response check
// =============================================================================
// Every 2xx JSON body that a contracted route sends through `makeTestApp()`
// is parsed with the route's `response` schema from `shared/contracts/`, and
// its status is compared with the contract's. A body the schema refuses, or a
// status the contract does not name, is recorded, and the test that caused it
// fails when it ends, naming the route and what differed, whether or not it
// looked at the answer. Production never parses a response: the check lives
// here alone.

const mismatches: string[] = [];

function failOnMismatch(): void {
  if (mismatches.length === 0) return;
  throw new Error(
    `A response broke its contract in shared/contracts/.\n\n${mismatches.splice(0).join("\n\n")}`,
  );
}

afterEach(failOnMismatch);
// A request made in an afterAll hook has no afterEach behind it.
afterAll(failOnMismatch);

/** Check each 2xx JSON answer of a contracted route against its contract. */
function checkResponses(app: Express): void {
  const json = app.response.json;
  app.response.json = function (this: Response, body: unknown) {
    const { req } = this;
    if (req.route && this.statusCode >= 200 && this.statusCode < 300) {
      // A router mounted at a prefix registers its root as "/".
      const path = `${req.baseUrl}${req.route.path}`.replace(/(.)\/$/, "$1");
      const key = routeKey(req.method, path);
      const contract = contractFor(key);
      if (contract) {
        const statuses = [contract.status ?? 200].flat();
        if (!statuses.includes(this.statusCode)) {
          mismatches.push(
            `${key} answered ${this.statusCode}, and its contract says ${statuses.join(" or ")}`,
          );
        }
        // The body as the client reads it: JSON drops an undefined field and
        // writes a Date as a string.
        const sent =
          body === undefined ? body : JSON.parse(JSON.stringify(body));
        const result = contract.response.safeParse(sent);
        if (!result.success) {
          mismatches.push(
            `${key} answered ${this.statusCode} with:\n${z.prettifyError(result.error)}`,
          );
        }
      }
    }
    return json.call(this, body);
  } as Express["response"]["json"];
}

/**
 * Build the production request pipeline exactly as server.ts does, minus
 * Vite/static SPA handling and the per-IP rate limiter.
 *
 * Returns a server that is ALREADY LISTENING, and that is the point.
 *
 * `request(expressApp)` makes supertest bind a fresh HTTP server and tear it
 * down again for every single request — roughly 500 listen/close cycles per
 * run. Ephemeral ports get recycled far faster than closed sockets leave
 * TIME_WAIT, so a new server occasionally inherits a port a previous
 * connection is still addressing, and a request is answered by the wrong
 * socket. The symptom is a status the route cannot produce: a 404 from a
 * registered path, a 403 from a router with no 403 in it, a 401 on an
 * un-gated instance. Chasing one of those means auditing auth code that was
 * never involved.
 *
 * Supertest reuses a server that already has an address instead of binding
 * one, so listening once per file removes the recycling entirely. `unref()`
 * keeps the open socket from holding the worker process alive after the last
 * test.
 */
export function makeTestApp(): http.Server {
  // A real better-sqlite3 connection reports `open`; the unit project's mock
  // does not. Checked here so that a leaked mock fails once, by name, instead
  // of surfacing later as an unrelated 404 in whichever test ran next.
  if (!(sqlite as unknown as { open?: boolean }).open) {
    throw new Error(
      "Integration tests require the real database, but server/db.ts is mocked. " +
        "Check that tests/integration-setup.ts ran for this file.",
    );
  }

  const app = createApp({ disableRateLimit: true });
  app.use(notFoundHandler);
  checkResponses(app);

  // Bound to loopback explicitly: supertest addresses the server as
  // 127.0.0.1 regardless of what it is bound to, so the default dual-stack
  // wildcard only widens what the test server accepts.
  const server = http.createServer(finalizeApp(app));
  server.listen(0, "127.0.0.1");
  server.unref();
  return server;
}

/**
 * Research one contact with one technique, as the queue and the route do,
 * and hand back the result as the merge reads it. Standard depth, and no
 * research so far, unless the request says otherwise.
 */
export async function researchWith(
  technique: string,
  request: Pick<ResearchRequest, "scope" | "contact"> &
    Partial<Omit<ResearchRequest, "scope" | "contact">>,
): Promise<AISearchResult> {
  return toAISearchResult(
    await research({ depth: "standard", history: null, technique, ...request }),
  );
}

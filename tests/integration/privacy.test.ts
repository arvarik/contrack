// =============================================================================
// Integration: what "Use AI for this account" keeps on the server
// =============================================================================
// The Privacy page says: "When it is off, Contrack sends nothing to an AI
// provider for you". Four paths still reached a provider with the account
// switch off, while AI was on for the instance: mention detection on a saved
// note, the summary of an attached .eml file, a search that an MCP client
// runs, and contact embeddings with a hosted model. Each test here runs one
// path for an account with AI on and for one with AI off. The call for the
// first account proves that the path runs, so the silence for the second is
// the switch's.
//
// The last block covers who "Enrich new contacts automatically" researches:
// the contacts a person adds, not the ones an MCP client or a sync adds.
//
// Every model call is mocked. No provider is reached.
// =============================================================================

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

vi.mock("../../server/ai/aiService.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/ai/aiService.ts")>();
  return {
    ...actual,
    extractMentions: vi.fn(async () => []),
    summarizeEmlEmail: vi.fn(async () => "<p>A summary</p>"),
  };
});

// A unit vector 384 wide, the width of the search store in a new database.
// The dedupe store is rebuilt at the same width before its test.
vi.mock("../../server/ai/embeddings.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/ai/embeddings.ts")>();
  return {
    ...actual,
    embedWithProvider: vi.fn(
      async (_providerId: string, _model: string, texts: string[]) =>
        texts.map(() =>
          Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
        ),
    ),
  };
});

import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import {
  asUser,
  createActor,
  resetAccounts,
  type Actor,
} from "./tenancy/helpers.ts";
import {
  extractMentions,
  summarizeEmlEmail,
} from "../../server/ai/aiService.ts";
import {
  embedWithProvider,
  resolveEmbeddings,
} from "../../server/ai/embeddings.ts";
import { invalidateProviderCache } from "../../server/ai/providerRegistry.ts";
import { setProviderKey } from "../../server/services/aiSettingsService.ts";
import {
  clearSettingsCache,
  setSetting,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import { setPreferences } from "../../server/services/userPreferencesService.ts";
import { searchService } from "../../server/services/searchService.ts";
import {
  backfillSearchEmbeddings,
  embedContact,
} from "../../server/services/search/vectorIndex.ts";
import {
  backfillEmbeddings,
  generateAndStoreEmbedding,
  rebuildDedupeEmbeddingTable,
} from "../../server/services/dedupe/embeddings.ts";
import { contactService } from "../../server/services/contactService.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import * as researchLayer from "../../server/services/research/index.ts";
import { createToken } from "../../server/services/apiTokenService.ts";
import { getUserById } from "../../server/services/authService.ts";
import { __resetMcpRateLimit } from "../../server/routes/mcp.ts";

let app: http.Server;
let aiOn: Actor;
let aiOff: Actor;
let tokenOn: string;
let tokenOff: string;

beforeAll(async () => {
  resetAccounts();
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  if (!app.listening) {
    await new Promise((resolve) => app.once("listening", resolve));
  }
  aiOn = await createActor(app, { username: "privacyon" });
  aiOff = await createActor(app, { username: "privacyoff" });
  const turnedOff = await asUser(aiOff)(
    request(app).patch("/api/auth/preferences").send({ aiAssist: false }),
  );
  expect(turnedOff.body.preferences.aiAssist).toBe(false);

  tokenOn = createToken(
    getUserById(aiOn.user.id)!,
    { name: "On" },
    "127.0.0.1",
  ).token;
  tokenOff = createToken(
    getUserById(aiOff.user.id)!,
    { name: "Off" },
    "127.0.0.1",
  ).token;
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  process.env.DISABLE_BACKGROUND_JOBS = "true";
  resetAccounts();
  __resetMcpRateLimit();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.prepare("DELETE FROM app_settings").run();
  clearSettingsCache();
  invalidateProviderCache();
});

/** Add a contact straight to the database, so no side effect runs. */
function addContact(actor: Actor, name: string): string {
  const id = `pv-${crypto.randomUUID().slice(0, 8)}`;
  sqlite
    .prepare(`INSERT INTO contacts (id, name, ownerId) VALUES (?, ?, ?)`)
    .run(id, name, actor.user.id);
  return id;
}

/** An MCP client that signs in with the token. */
async function mcpClient(token: string): Promise<Client> {
  const { port } = app.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/api/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const client = new Client({ name: "privacy-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

/** A provider with a key, so Contrack counts AI as set up. */
function connectProvider(): void {
  setProviderKey("openai", "sk-privacy-test-1234");
  invalidateProviderCache();
}

/** An admin's choice of a hosted embedding model, for every account. */
function pinHostedEmbeddings(): void {
  connectProvider();
  setSetting(SETTING_KEYS.aiCapabilities, {
    embeddings: {
      mode: "pinned",
      providerId: "openai",
      model: "text-embedding-3-small",
    },
  });
  expect(resolveEmbeddings().kind).toBe("provider");
}

/** Every text the hosted embedding model was sent. */
function textsSentToProvider(): string {
  return vi
    .mocked(embedWithProvider)
    .mock.calls.flatMap((call) => call[2])
    .join("\n")
    .toLowerCase();
}

describe("mention detection on a saved note", () => {
  it("reads the note for an account with AI on, and never for one with AI off", async () => {
    process.env.DISABLE_BACKGROUND_JOBS = "";
    try {
      const saveNote = async (actor: Actor, content: string) => {
        const contactId = addContact(actor, "Note Anchor");
        const res = await asUser(actor)(
          request(app)
            .post(`/api/contacts/${contactId}/interactions`)
            .send({ type: "note", title: "Lunch", content }),
        );
        expect(res.status).toBe(201);
      };

      await saveNote(aiOff, "Lunch with Grace Hopper, AI off");
      await saveNote(aiOn, "Lunch with Grace Hopper, AI on");

      // The jobs run on timers, in order. Once the second note has reached
      // the model, the first one has had its turn.
      await vi.waitFor(() =>
        expect(extractMentions).toHaveBeenCalledWith(
          "Lunch with Grace Hopper, AI on",
        ),
      );
      expect(extractMentions).toHaveBeenCalledTimes(1);
    } finally {
      process.env.DISABLE_BACKGROUND_JOBS = "true";
    }
  });
});

describe("the summary of an attached .eml file", () => {
  const eml = Buffer.from(
    "From: ada@example.com\r\nTo: grace@example.com\r\nSubject: Hello\r\n\r\nSee you on Monday.\r\n",
  );
  const attach = (actor: Actor) =>
    asUser(actor)(
      request(app)
        .post(`/api/contacts/${addContact(actor, "Email Anchor")}/attachments`)
        .attach("attachment", eml, "thread.eml"),
    );

  it("summarizes for an account with AI on, and saves the file alone with AI off", async () => {
    connectProvider();

    const on = await attach(aiOn);
    expect(on.status).toBe(201);
    expect(on.body.content).toBe("<p>A summary</p>");
    expect(summarizeEmlEmail).toHaveBeenCalledTimes(1);

    const off = await attach(aiOff);
    expect(off.status).toBe(201);
    expect(off.body).toMatchObject({
      type: "email",
      content: null,
      fileName: "thread.eml",
    });
    expect(summarizeEmlEmail).toHaveBeenCalledTimes(1);
  });

  it("saves the file with no summary when no provider is set up", async () => {
    const res = await attach(aiOn);
    expect(res.status).toBe(201);
    expect(res.body.content).toBeNull();
    expect(summarizeEmlEmail).not.toHaveBeenCalled();
  });
});

describe("a search that an MCP client runs", () => {
  it("runs no model stage for an account with AI off", async () => {
    addContact(aiOn, "Grace Hopper");
    addContact(aiOff, "Grace Hopper");
    const search = vi.spyOn(searchService, "semanticSearch");

    for (const token of [tokenOn, tokenOff]) {
      const client = await mcpClient(token);
      const res = await client.callTool({
        name: "search_people",
        arguments: { query: "Grace" },
      });
      expect(res.isError).toBeFalsy();
      await client.close();
    }

    // The same flag Ask Contrack reads in the app.
    expect(search.mock.calls.map((call) => call[4]?.aiAllowed)).toEqual([
      true,
      false,
    ]);
  });
});

describe("contact embeddings with a hosted model", () => {
  it("indexes an account with AI on for search, and sends nothing of an account with AI off", async () => {
    pinHostedEmbeddings();
    const onId = addContact(aiOn, "Hosted Search On");
    const offId = addContact(aiOff, "Hosted Search Off");

    // One contact, as the queue embeds it after an edit.
    await expect(embedContact(offId)).resolves.toEqual({
      status: "skipped",
      reason: "ai_off",
    });
    expect(embedWithProvider).not.toHaveBeenCalled();
    await expect(embedContact(onId)).resolves.toEqual({ status: "indexed" });
    expect(textsSentToProvider()).toContain("hosted search on");

    // Every missing contact of every account, as at startup.
    vi.mocked(embedWithProvider).mockClear();
    addContact(aiOn, "Hosted Search Later");
    await backfillSearchEmbeddings();
    expect(textsSentToProvider()).toContain("hosted search later");
    expect(textsSentToProvider()).not.toContain("hosted search off");
  });

  it("gives the duplicate checks no vector of an account with AI off", async () => {
    pinHostedEmbeddings();
    rebuildDedupeEmbeddingTable(384);
    const onId = addContact(aiOn, "Hosted Dedupe On");
    const offId = addContact(aiOff, "Hosted Dedupe Off");

    // One contact, as after an add or an edit.
    expect(await generateAndStoreEmbedding(offId)).toBe(false);
    expect(embedWithProvider).not.toHaveBeenCalled();
    expect(await generateAndStoreEmbedding(onId)).toBe(true);
    expect(textsSentToProvider()).toContain("hosted dedupe on");

    // Every missing contact of every account, as the repair button runs it.
    vi.mocked(embedWithProvider).mockClear();
    addContact(aiOn, "Hosted Dedupe Later");
    await backfillEmbeddings();
    expect(textsSentToProvider()).toContain("hosted dedupe later");
    expect(textsSentToProvider()).not.toContain("hosted dedupe off");
  });

  it("refuses to queue an index of an account with AI off", async () => {
    pinHostedEmbeddings();

    const off = await asUser(aiOff)(
      request(app)
        .post("/api/search/refresh-index")
        .send({ allowProvider: true }),
    );
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe("AI_OFF_FOR_ACCOUNT");

    // With AI on, the same request asks for the cost to be confirmed.
    const on = await asUser(aiOn)(
      request(app).post("/api/search/refresh-index").send({}),
    );
    expect(on.status).toBe(400);
    expect(on.body.requiresExplicitConfirmation).toBe(true);
  });
});

describe("Enrich new contacts automatically", () => {
  it("researches a contact a person adds, and not one an MCP client or a sync adds", async () => {
    vi.spyOn(researchLayer, "chooseResearch").mockReturnValue({
      technique: "provider-search",
    });
    const createBatch = vi.spyOn(jobQueue, "createBatch");
    vi.spyOn(jobQueue, "processBatch").mockResolvedValue(
      undefined as unknown as void,
    );
    setPreferences(aiOn.user.id, { autoEnrich: true });
    try {
      const byHand = await asUser(aiOn)(
        request(app).post("/api/contacts").send({ name: "Added By Hand" }),
      );
      expect(byHand.status).toBe(201);
      expect(createBatch).toHaveBeenCalledTimes(1);

      const client = await mcpClient(tokenOn);
      const byMcp = await client.callTool({
        name: "create_contact",
        arguments: { name: "Added By An MCP Client" },
      });
      expect(byMcp.isError).toBeFalsy();
      await client.close();

      // The call a Google sync makes (server/connectors/ingest.ts).
      contactService.createContact(
        aiOn.scope,
        { name: "Added By A Sync" },
        "google",
      );

      expect(createBatch).toHaveBeenCalledTimes(1);
    } finally {
      jobQueue.__resetForTests();
      setPreferences(aiOn.user.id, { autoEnrich: false });
    }
  });
});

/**
 * tests/integration/api.mcp.test.ts — Integration tests for the MCP Server.
 *
 * Tests:
 * - SDK Client connection over StreamableHTTPClientTransport
 * - Server initialization and tool listing matching shared/mcpTools.ts
 * - search_people finds a seeded person
 * - get_contact returns the contact, and a score explanation once tracked
 * - list_contacts with filtering and cursor pagination
 * - log_interaction and get_timeline
 * - search_notes
 * - list_action_items, create_action_item, complete_action_item
 * - get_pulse dashboard payload
 * - list_tags, list_lists, add_to_list
 * - Multi-tenant isolation: Account B token cannot get Account A contact (NOT_FOUND error)
 * - 401 when unauthenticated
 * - 120/min rate limiting (429 on 121st call)
 * - Resources: contrack://pulse and contrack://contacts/{id}
 * - Prompts: catch_me_up and weekly_review
 * - A read-only token: only the read tools, and REST refuses its writes
 * - Duplicate checks, list and tag edits, follow-up changes, input checks
 *
 * @module tests/integration/api.mcp.test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type http from "http";
import { type AddressInfo } from "net";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import {
  createActor,
  resetAccounts,
  seedOwner,
  type Actor,
  type Seeded,
} from "./tenancy/helpers.ts";
import { createToken } from "../../server/services/apiTokenService.ts";
import { getUserById } from "../../server/services/authService.ts";
import { MCP_TOOLS } from "../../shared/mcpTools.ts";
import { __resetMcpRateLimit } from "../../server/routes/mcp.ts";

describe("MCP Server (/api/mcp)", () => {
  let server: http.Server;
  let serverPort: number;
  let endpointUrl: URL;

  let actorA: Actor;
  let actorB: Actor;
  let tokenA: string;
  let tokenB: string;
  let seedA: Seeded;

  beforeAll(async () => {
    resetAccounts();
    process.env.AUTH_REQUIRED = "true";

    server = makeTestApp();
    if (!server.listening) {
      await new Promise((resolve) => server.once("listening", resolve));
    }
    const addr = server.address() as AddressInfo;
    serverPort = addr.port;
    endpointUrl = new URL(`http://127.0.0.1:${serverPort}/api/mcp`);

    actorA = await createActor(server, {
      username: "alice",
      email: "alice@example.com",
    });
    actorB = await createActor(server, {
      username: "bob",
      email: "bob@example.com",
    });

    tokenA = createToken(
      getUserById(actorA.user.id)!,
      { name: "Token A" },
      "127.0.0.1",
    ).token;
    tokenB = createToken(
      getUserById(actorB.user.id)!,
      { name: "Token B" },
      "127.0.0.1",
    ).token;

    seedA = await seedOwner(server, actorA, {
      contacts: 3,
      interactions: 2,
      actionItems: 2,
      lists: 1,
    });
    await seedOwner(server, actorB, { contacts: 2 });
  });

  afterAll(() => {
    process.env.AUTH_REQUIRED = "";
    resetAccounts();
    __resetMcpRateLimit();
  });

  async function makeConnectedClient(token: string) {
    const transport = new StreamableHTTPClientTransport(endpointUrl, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  it("initializes and lists tools matching shared/mcpTools.ts", async () => {
    const client = await makeConnectedClient(tokenA);

    const toolList = await client.listTools();
    const serverToolNames = toolList.tools.map((t) => t.name).sort();
    const expectedToolNames = MCP_TOOLS.map((t) => t.name)
      .slice()
      .sort();

    expect(serverToolNames).toEqual(expectedToolNames);
    expect(toolList.tools).toHaveLength(18);

    await client.close();
  });

  it("search_people finds a seeded person", async () => {
    const client = await makeConnectedClient(tokenA);

    const res = await client.callTool({
      name: "search_people",
      arguments: { query: "Alice" },
    });

    expect(res.isError).toBeFalsy();
    const structured = (
      res as { structuredContent?: { matches: Array<{ name: string }> } }
    ).structuredContent;
    expect(structured?.matches.length).toBeGreaterThan(0);
    expect(
      structured?.matches.some((m) => m.name.toLowerCase().includes("alice")),
    ).toBe(true);

    await client.close();
  });

  it("list_contacts pages through the contacts with a cursor", async () => {
    const client = await makeConnectedClient(tokenA);
    type Page = {
      structuredContent?: {
        contacts: { id: string }[];
        nextCursor: string | null;
      };
    };

    const first = (await client.callTool({
      name: "list_contacts",
      arguments: { limit: 2 },
    })) as Page;
    expect(first.structuredContent?.contacts).toHaveLength(2);
    expect(first.structuredContent?.nextCursor).toBeTruthy();

    const second = (await client.callTool({
      name: "list_contacts",
      arguments: { limit: 2, cursor: first.structuredContent!.nextCursor! },
    })) as Page;
    expect(second.structuredContent?.nextCursor).toBeNull();

    // Two pages with no overlap are the three contacts seeded for A.
    const ids = [
      ...first.structuredContent!.contacts,
      ...second.structuredContent!.contacts,
    ].map((c) => c.id);
    expect(ids.sort()).toEqual([...seedA.contactIds].sort());

    await client.close();
  });

  it("get_contact has no score explanation for an untracked contact, and writes nothing", async () => {
    const client = await makeConnectedClient(tokenA);
    const contactId = seedA.contactIds[1];
    const snapshot = () =>
      sqlite
        .prepare(
          `SELECT relationshipScore, scoreDirty, updatedAt FROM contacts WHERE id = ?`,
        )
        .get(contactId);
    const before = snapshot();

    const res = await client.callTool({
      name: "get_contact",
      arguments: { id: contactId },
    });

    expect(res.isError).toBeFalsy();
    const structured = (
      res as {
        structuredContent?: {
          contact: { id: string; isTracked: boolean };
          scoreExplanation: unknown;
        };
      }
    ).structuredContent;
    expect(structured?.contact.id).toBe(contactId);
    expect(structured?.contact.isTracked).toBe(false);
    expect(structured?.scoreExplanation).toBeNull();
    expect(snapshot()).toEqual(before);

    await client.close();
  });

  it("update_contact can track a contact, and get_contact then explains its score", async () => {
    const client = await makeConnectedClient(tokenA);
    const contactId = seedA.contactIds[1];

    const updated = await client.callTool({
      name: "update_contact",
      arguments: {
        id: contactId,
        fields: { isTracked: true, cadenceDays: 30 },
      },
    });
    expect(updated.isError).toBeFalsy();
    const contact = (
      updated as {
        structuredContent?: {
          isTracked: boolean;
          cadenceDays: number;
          trackedAt: string | null;
        };
      }
    ).structuredContent;
    expect(contact?.isTracked).toBe(true);
    expect(contact?.cadenceDays).toBe(30);
    expect(typeof contact?.trackedAt).toBe("string");

    const res = await client.callTool({
      name: "get_contact",
      arguments: { id: contactId },
    });
    const structured = (
      res as { structuredContent?: { scoreExplanation: { score: number } } }
    ).structuredContent;
    expect(typeof structured?.scoreExplanation?.score).toBe("number");

    // Back to untracked, so the other tests see the seed they expect.
    await client.callTool({
      name: "update_contact",
      arguments: { id: contactId, fields: { isTracked: false } },
    });
    await client.close();
  });

  it("list_contacts filters by tracked", async () => {
    const client = await makeConnectedClient(tokenA);
    const contactId = seedA.contactIds[2];
    await client.callTool({
      name: "update_contact",
      arguments: { id: contactId, fields: { isTracked: true } },
    });

    const tracked = await client.callTool({
      name: "list_contacts",
      arguments: { tracked: true },
    });
    const trackedRows = (
      tracked as {
        structuredContent?: { contacts: { id: string; isTracked: number }[] };
      }
    ).structuredContent?.contacts;
    expect(trackedRows?.map((c) => c.id)).toEqual([contactId]);

    const untracked = await client.callTool({
      name: "list_contacts",
      arguments: { tracked: false },
    });
    const untrackedRows = (
      untracked as { structuredContent?: { contacts: { id: string }[] } }
    ).structuredContent?.contacts;
    expect(untrackedRows?.some((c) => c.id === contactId)).toBe(false);
    expect(untrackedRows?.length).toBeGreaterThan(0);

    await client.callTool({
      name: "update_contact",
      arguments: { id: contactId, fields: { isTracked: false } },
    });
    await client.close();
  });

  it("log_interaction writes an interaction that appears in get_timeline", async () => {
    const client = await makeConnectedClient(tokenA);

    const contactId = seedA.contactIds[0];
    const logRes = await client.callTool({
      name: "log_interaction",
      arguments: {
        contactId,
        type: "meeting",
        title: "Q3 Strategic Sync",
        content: "Discussed roadmap and milestones.",
      },
    });

    expect(logRes.isError).toBeFalsy();

    const timelineRes = await client.callTool({
      name: "get_timeline",
      arguments: { contactId },
    });

    expect(timelineRes.isError).toBeFalsy();
    const structured = (res: unknown) =>
      (res as { structuredContent?: { timeline: Array<{ title: string }> } })
        .structuredContent;
    const items = structured(timelineRes)?.timeline ?? [];
    expect(items.some((item) => item.title === "Q3 Strategic Sync")).toBe(true);

    await client.close();
  });

  it("search_notes finds the logged interaction", async () => {
    const client = await makeConnectedClient(tokenA);

    const res = await client.callTool({
      name: "search_notes",
      arguments: { query: "Strategic" },
    });

    expect(res.isError).toBeFalsy();
    const structured = (
      res as { structuredContent?: { hits: Array<{ title: string }> } }
    ).structuredContent;
    expect(structured?.hits.some((h) => h.title.includes("Strategic"))).toBe(
      true,
    );

    await client.close();
  });

  it("list_action_items, create_action_item, and complete_action_item", async () => {
    const client = await makeConnectedClient(tokenA);

    const contactId = seedA.contactIds[0];
    const createRes = await client.callTool({
      name: "create_action_item",
      arguments: {
        contactId,
        title: "Follow up on proposal",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    expect(createRes.isError).toBeFalsy();
    const createdItem = (createRes as { structuredContent?: { id: string } })
      .structuredContent;
    expect(createdItem?.id).toBeDefined();

    const listRes = await client.callTool({
      name: "list_action_items",
      arguments: { due: "all" },
    });
    expect(listRes.isError).toBeFalsy();
    const items = (
      listRes as { structuredContent?: { actionItems: Array<{ id: string }> } }
    ).structuredContent?.actionItems;
    expect(items?.some((i) => i.id === createdItem?.id)).toBe(true);

    const completeRes = await client.callTool({
      name: "complete_action_item",
      arguments: { id: createdItem!.id },
    });
    expect(completeRes.isError).toBeFalsy();
    expect(
      (completeRes as { structuredContent?: { completedAt: string | null } })
        .structuredContent?.completedAt,
    ).toEqual(expect.any(String));

    await client.close();
  });

  it("get_pulse returns the dashboard metrics", async () => {
    const client = await makeConnectedClient(tokenA);

    const res = await client.callTool({
      name: "get_pulse",
    });

    expect(res.isError).toBeFalsy();
    const pulse = (
      res as { structuredContent?: { metrics: { totalActive: number } } }
    ).structuredContent;
    expect(pulse?.metrics.totalActive).toBeGreaterThan(0);

    await client.close();
  });

  it("list_tags, list_lists, and add_to_list", async () => {
    const client = await makeConnectedClient(tokenA);
    const [listId] = seedA.listIds;

    const tagsRes = await client.callTool({ name: "list_tags" });
    expect(tagsRes.isError).toBeFalsy();
    // The seed tags nobody.
    expect(
      (tagsRes as { structuredContent?: { tags: unknown[] } }).structuredContent
        ?.tags,
    ).toEqual([]);

    const added = await client.callTool({
      name: "add_to_list",
      arguments: { listId, contactIds: [seedA.contactIds[0]] },
    });
    expect(added.isError).toBeFalsy();
    expect(
      (added as { structuredContent?: { listId: string; addedCount: number } })
        .structuredContent,
    ).toMatchObject({ listId, addedCount: 1 });

    const listsRes = await client.callTool({ name: "list_lists" });
    expect(listsRes.isError).toBeFalsy();
    expect(
      (
        listsRes as {
          structuredContent?: {
            lists: { id: string; name: string; memberCount: number }[];
          };
        }
      ).structuredContent?.lists,
    ).toEqual([
      expect.objectContaining({
        id: listId,
        name: "alice List 0",
        memberCount: 1,
      }),
    ]);

    await client.close();
  });

  it("multi-tenant isolation: Account B token cannot get Account A's contact", async () => {
    const client = await makeConnectedClient(tokenB);

    const contactA = seedA.contactIds[0];

    try {
      await client.callTool({
        name: "get_contact",
        arguments: { id: contactA },
      });
      expect.fail(
        "Expected get_contact on foreign contact to throw a JSON-RPC error",
      );
    } catch (err: unknown) {
      const mcpErr = err as { code?: number; data?: { code?: string } };
      expect(mcpErr.data?.code).toBe("NOT_FOUND");
    }

    await client.close();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(server)
      .post("/api/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

    expect(res.status).toBe(401);
  });

  it("rate limiter: 120/min per account, 121st call returns 429", async () => {
    __resetMcpRateLimit();

    // 120 calls succeed
    for (let i = 0; i < 120; i++) {
      const res = await request(server)
        .post("/api/mcp")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Accept", "application/json, text/event-stream")
        .send({
          jsonrpc: "2.0",
          id: i,
          method: "tools/list",
        });
      expect(res.status).toBe(200);
    }

    // 121st call must be rate limited
    const limitedRes = await request(server)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 121,
        method: "tools/list",
      });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers["retry-after"]).toBeDefined();

    __resetMcpRateLimit();
  });

  it("reads resources: contrack://pulse and contrack://contacts/{id}", async () => {
    const client = await makeConnectedClient(tokenA);

    const pulseRes = await client.readResource({ uri: "contrack://pulse" });
    expect(pulseRes.contents).toHaveLength(1);
    const pulseItem = pulseRes.contents[0] as { text: string };
    const pulseJson = JSON.parse(pulseItem.text);
    expect(pulseJson.metrics).toBeDefined();

    const contactId = seedA.contactIds[0];
    const contactRes = await client.readResource({
      uri: `contrack://contacts/${contactId}`,
    });
    expect(contactRes.contents).toHaveLength(1);
    const contactItem = contactRes.contents[0] as { text: string };
    const contactJson = JSON.parse(contactItem.text);
    expect(contactJson.id).toBe(contactId);
    // This contact is untracked, so the key is there with no score in it.
    expect(contactJson.scoreExplanation).toBeNull();

    await client.close();
  });

  it("retrieves prompts: catch_me_up and weekly_review", async () => {
    const client = await makeConnectedClient(tokenA);

    const contactId = seedA.contactIds[0];
    const catchPrompt = await client.getPrompt({
      name: "catch_me_up",
      arguments: { contactId },
    });
    expect(catchPrompt.messages.length).toBeGreaterThan(0);

    const weeklyPrompt = await client.getPrompt({
      name: "weekly_review",
    });
    expect(weeklyPrompt.messages.length).toBeGreaterThan(0);

    await client.close();
  });

  /** What the tests below read from a tool's structured result. */
  type Result = {
    id: string;
    dueAt: string;
    removedCount: number;
    contacts: { id: string }[];
    emails: { email: string; isPrimary: boolean }[];
    tags: { tag: string }[];
    timeline: { title: string }[];
  };

  /** Call a tool and return its result. A tool error rejects, as an app error does. */
  async function call(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Result> {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(JSON.stringify(res.content));
    return res.structuredContent as Result;
  }

  it("a read-only token lists only the read tools, and REST refuses its writes", async () => {
    const token = createToken(
      getUserById(actorA.user.id)!,
      { name: "Reader", readOnly: true },
      "127.0.0.1",
    ).token;
    const client = await makeConnectedClient(token);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      MCP_TOOLS.filter((t) => t.readOnly)
        .map((t) => t.name)
        .sort(),
    );
    expect(client.getInstructions()).toContain("read-only");
    await client.close();

    const bearer = `Bearer ${token}`;
    const read = await request(server)
      .get("/api/contacts")
      .set("Authorization", bearer);
    expect(read.status).toBe(200);
    const write = await request(server)
      .post("/api/lists")
      .set("Authorization", bearer)
      .send({ name: "Not allowed" });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("TOKEN_READ_ONLY");
  });

  it("create_contact refuses a known email or phone, and list_contacts finds both", async () => {
    const client = await makeConnectedClient(tokenA);
    const rowan = await call(client, "create_contact", {
      name: "Rowan Vale",
      emails: [{ email: "rowan@example.com" }],
      phones: [{ phone: "+1 (415) 555-0100" }],
    });

    for (const contact of [
      { emails: [{ email: "ROWAN@example.com" }] },
      { phones: [{ phone: "415-555-0100" }] },
    ]) {
      await expect(
        call(client, "create_contact", { name: "R. Vale", ...contact }),
      ).rejects.toMatchObject({ data: { code: "DUPLICATE_CONTACT" } });
    }
    for (const filter of [
      { email: "Rowan@Example.com" },
      { phone: "4155550100" },
    ]) {
      const found = await call(client, "list_contacts", filter);
      expect(found.contacts.map((c) => c.id)).toEqual([rowan.id]);
    }

    const twin = await call(client, "create_contact", {
      name: "Rowan Vale",
      emails: [{ email: "rowan@example.com" }],
      allowDuplicate: true,
    });
    expect(twin.id).not.toBe(rowan.id);
    await client.close();
  });

  it("update_contact edits emails and tags in place, and the list and follow-up tools write", async () => {
    const client = await makeConnectedClient(tokenA);
    const id = seedA.contactIds[2];
    await call(client, "update_contact", {
      id,
      fields: {
        addEmails: ["a@example.com", "b@example.com"],
        addTags: ["Investor"],
      },
    });
    const edited = await call(client, "update_contact", {
      id,
      fields: {
        removeEmails: ["A@example.com"],
        addTags: ["investor", "Advisor"],
      },
    });
    // The primary email went, so the one left became primary.
    expect(edited.emails).toMatchObject([
      { email: "b@example.com", isPrimary: true },
    ]);
    expect(edited.tags.map((t) => t.tag).sort()).toEqual([
      "Advisor",
      "Investor",
    ]);

    const list = await call(client, "create_list", { name: "Conference 2026" });
    await expect(
      call(client, "create_list", { name: "conference 2026" }),
    ).rejects.toMatchObject({ data: { code: "DUPLICATE_LIST" } });
    await call(client, "add_to_list", { listId: list.id, contactIds: [id] });
    const members = await call(client, "list_contacts", {
      list: "Conference 2026",
      tag: "advisor",
    });
    expect(members.contacts.map((c) => c.id)).toEqual([id]);
    const removed = await call(client, "remove_from_list", {
      listId: list.id,
      contactIds: [id],
    });
    expect(removed.removedCount).toBe(1);

    const item = await call(client, "create_action_item", {
      contactId: id,
      title: "Send the deck",
      dueAt: "2030-01-15",
    });
    const moved = await call(client, "update_action_item", {
      id: item.id,
      dueAt: "2030-02-01",
    });
    expect(moved.dueAt).toBe("2030-02-01");
    await client.close();
  });

  it("refuses bad dates and limits, and log_interaction links mentionContactIds", async () => {
    const client = await makeConnectedClient(tokenA);
    const [owner, other] = seedA.contactIds;
    for (const [name, args] of [
      [
        "log_interaction",
        { contactId: owner, title: "Later", date: "2099-01-01" },
      ],
      [
        "create_action_item",
        { contactId: owner, title: "Call", dueAt: "next Friday" },
      ],
      ["search_people", { query: "Contact", limit: 31 }],
    ] as const) {
      const res = await client.callTool({ name, arguments: args });
      expect(res.isError, name).toBe(true);
    }

    await call(client, "log_interaction", {
      contactId: owner,
      title: "Board prep",
      content: "Went through the deck.",
      mentionContactIds: [other],
    });
    const theirs = await call(client, "get_timeline", { contactId: other });
    expect(theirs.timeline.map((i) => i.title)).toContain("Board prep");
    await client.close();
  });
});

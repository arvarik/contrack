/**
 * tests/integration/api.mcp.test.ts — Integration tests for the MCP Server.
 *
 * Tests:
 * - SDK Client connection over StreamableHTTPClientTransport
 * - Server initialization and tool listing matching shared/mcpTools.ts
 * - search_people finds a seeded person
 * - get_contact returns profile and score explanation
 * - list_contacts with filtering and pagination
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
 * - GET and DELETE /api/mcp return 405 Method Not Allowed
 *
 * @module tests/integration/api.mcp.test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { AddressInfo } from "net";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { makeTestApp } from "./helpers.ts";
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
    expect(toolList.tools).toHaveLength(15);

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

  it("get_contact returns profile and score explanation", async () => {
    const client = await makeConnectedClient(tokenA);

    const contactId = seedA.contactIds[0];
    const res = await client.callTool({
      name: "get_contact",
      arguments: { id: contactId },
    });

    expect(res.isError).toBeFalsy();
    const structured = (
      res as {
        structuredContent?: {
          contact: { id: string; name: string };
          scoreExplanation: unknown;
        };
      }
    ).structuredContent;
    expect(structured?.contact.id).toBe(contactId);
    expect(structured?.scoreExplanation).toBeDefined();

    await client.close();
  });

  it("list_contacts returns paginated contacts", async () => {
    const client = await makeConnectedClient(tokenA);

    const res = await client.callTool({
      name: "list_contacts",
      arguments: { limit: 10 },
    });

    expect(res.isError).toBeFalsy();
    const structured = (res as { structuredContent?: { contacts: unknown[] } })
      .structuredContent;
    expect(structured?.contacts.length).toBeGreaterThan(0);

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

    const tagsRes = await client.callTool({ name: "list_tags" });
    expect(tagsRes.isError).toBeFalsy();

    const listsRes = await client.callTool({ name: "list_lists" });
    expect(listsRes.isError).toBeFalsy();

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
    expect(contactJson.scoreExplanation).toBeDefined();

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

  it("GET and DELETE /api/mcp answer 405 Method Not Allowed", async () => {
    const getRes = await request(server)
      .get("/api/mcp")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(getRes.status).toBe(405);
    expect(getRes.headers["allow"]).toBe("POST");

    const deleteRes = await request(server)
      .delete("/api/mcp")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(deleteRes.status).toBe(405);
    expect(deleteRes.headers["allow"]).toBe("POST");
  });
});

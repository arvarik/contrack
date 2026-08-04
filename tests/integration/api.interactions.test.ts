// =============================================================================
// Integration: interactions, @mention linking, action items, lists
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

async function createContact(name: string): Promise<string> {
  const res = await request(app).post("/api/contacts").send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("interactions + timeline", () => {
  it("creates an interaction and returns it on the timeline", async () => {
    const id = await createContact("Timeline Owner");

    const created = await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "note", title: "Coffee chat", content: "<p>Notes</p>" });
    expect(created.status).toBe(201);

    const timeline = await request(app).get(`/api/contacts/${id}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body).toHaveLength(1);
    expect(timeline.body[0].title).toBe("Coffee chat");
  });

  it("stamps lastContactedAt on the contact", async () => {
    const id = await createContact("Last Contacted");
    await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "call", title: "Quick sync" });

    const contact = await request(app).get(`/api/contacts/${id}`);
    expect(contact.body.lastContactedAt).toBeTruthy();
  });

  it("links explicit @mentions so the interaction appears on the mentioned contact's timeline", async () => {
    const authorId = await createContact("Mention Author");
    const mentionedId = await createContact("Mentioned Person");

    // TipTap emits mention nodes with data-type/data-id attributes.
    const content = `<p>Discussed the deal with <span data-type="mention" class="mention" data-id="${mentionedId}">@Mentioned Person</span> today.</p>`;
    const created = await request(app)
      .post(`/api/contacts/${authorId}/interactions`)
      .send({ type: "meeting", title: "Deal discussion", content });
    expect(created.status).toBe(201);

    // The mentioned contact's timeline must include the interaction via the
    // interaction_mentions join, attributed to the author ("via").
    const timeline = await request(app).get(
      `/api/contacts/${mentionedId}/timeline`,
    );
    expect(timeline.status).toBe(200);
    const viaEntry = timeline.body.find(
      (i: { title: string }) => i.title === "Deal discussion",
    );
    expect(viaEntry).toBeTruthy();
    expect(viaEntry.isViaName).toBe("Mention Author");
  });

  it("updates and deletes interactions with validation", async () => {
    const id = await createContact("Interaction CRUD");
    const created = await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "note", title: "Original" });
    const interactionId = created.body.id;

    const emptyPatch = await request(app)
      .patch(`/api/interactions/${interactionId}`)
      .send({});
    expect(emptyPatch.status).toBe(400);

    const patched = await request(app)
      .patch(`/api/interactions/${interactionId}`)
      .send({ title: "Renamed" });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe("Renamed");

    const deleted = await request(app).delete(
      `/api/interactions/${interactionId}`,
    );
    expect(deleted.status).toBe(200);

    const timeline = await request(app).get(`/api/contacts/${id}/timeline`);
    expect(timeline.body).toHaveLength(0);
  });
});

describe("action items + nextFollowUpAt trigger", () => {
  it("creating an action item sets the contact's nextFollowUpAt", async () => {
    const id = await createContact("Follow Up");
    const dueAt = "2030-01-15T10:00:00.000Z";

    const created = await request(app)
      .post(`/api/contacts/${id}/action-items`)
      .send({ title: "Send proposal", dueAt });
    expect(created.status).toBe(201);

    const contact = await request(app).get(`/api/contacts/${id}`);
    expect(contact.body.nextFollowUpAt).toBe(dueAt);
  });

  it("completing the action item clears nextFollowUpAt via trigger", async () => {
    const id = await createContact("Follow Up Done");
    const created = await request(app)
      .post(`/api/contacts/${id}/action-items`)
      .send({ title: "Task", dueAt: "2030-02-01T00:00:00.000Z" });

    const completed = await request(app).patch(
      `/api/action-items/${created.body.id}/complete`,
    );
    expect(completed.status).toBe(200);

    const contact = await request(app).get(`/api/contacts/${id}`);
    expect(contact.body.nextFollowUpAt).toBeNull();
  });

  it("counts urgent (due/overdue) action items only", async () => {
    const id = await createContact("Count Owner");
    // Urgent: overdue item counts; a 2030 item must not.
    await request(app)
      .post(`/api/contacts/${id}/action-items`)
      .send({ title: "Overdue thing", dueAt: "2020-01-01T00:00:00.000Z" });
    await request(app)
      .post(`/api/contacts/${id}/action-items`)
      .send({ title: "Far future thing", dueAt: "2030-03-01T00:00:00.000Z" });

    const count = await request(app).get("/api/action-items/count");
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(1);
  });
});

describe("lists", () => {
  it("creates a list, manages members, and deletes it", async () => {
    const contactId = await createContact("List Member");

    const list = await request(app)
      .post("/api/lists")
      .send({ name: "VIPs", icon: "star" });
    expect(list.status).toBe(201);
    const listId = list.body.id;

    const added = await request(app)
      .post(`/api/lists/${listId}/members`)
      .send({ contactId });
    expect(added.status).toBeLessThan(300);

    const members = await request(app).get(`/api/lists/${listId}/contacts`);
    expect(members.status).toBe(200);
    expect(members.body.some((c: { id: string }) => c.id === contactId)).toBe(
      true,
    );

    const all = await request(app).get("/api/lists");
    expect(
      all.body.some(
        (l: { id: string; memberCount?: number }) => l.id === listId,
      ),
    ).toBe(true);

    const removed = await request(app).delete(`/api/lists/${listId}`);
    expect(removed.status).toBeLessThan(300);
  });
});

// Integration: the server log holds no text a person typed. It held contact
// names, note titles, palette searches, Ask questions and, in an error line,
// the whole query string. A session at LOG_LEVEL=debug must log none of them.

import { afterAll, beforeAll, expect, it, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const MARK = "Quixmarker";
const app = makeTestApp();
const lines: string[] = [];

beforeAll(() => {
  vi.stubEnv("LOG_LEVEL", "debug");
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  app.close();
});

it("logs a contact, a note and two searches by id and count only", async () => {
  const contact = await request(app)
    .post("/api/contacts")
    .send({ name: `Zelda ${MARK}`, email: `zelda.${MARK}@example.com` });
  expect(contact.status).toBe(201);
  const note = await request(app)
    .post(`/api/contacts/${contact.body.id}/interactions`)
    .send({ type: "note", title: `${MARK} errand`, content: `<p>${MARK}</p>` });
  expect(note.status).toBe(201);
  const palette = await request(app).get("/api/search").query({ q: MARK });
  expect(palette.body).toHaveLength(1);
  const ask = await request(app)
    .post("/api/search/semantic")
    .send({ query: `who is ${MARK}` });
  expect(ask.status).toBe(200);
  const unknown = await request(app)
    .get("/api/nothing-here")
    .query({ q: MARK });
  expect(unknown.status).toBe(404);
  // The note's background work logs after the response.
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(lines.some((line) => line.includes(contact.body.id))).toBe(true);
  expect(lines.some((line) => line.includes("/api/nothing-here →"))).toBe(true);
  expect(lines.filter((line) => /quixmarker/i.test(line))).toEqual([]);
});

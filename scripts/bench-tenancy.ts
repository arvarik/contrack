// =============================================================================
// bench-tenancy — the before picture
// =============================================================================
// Phase 5 has to show that scoping every query did not make the app slower.
// That claim needs a number from before the work started, measured the same
// way, so this script is written in Phase 0 and run again at the end.
//
// The 10-owner run is the one that matters. Nothing is scoped yet, so every
// list endpoint hands all 20,000 contacts to each of the ten owners. Phase 2
// should make those endpoints faster, not slower, because each owner then
// reads a tenth of the rows.
//
//   npx tsx scripts/bench-tenancy.ts                 # 1 owner, 5000 contacts
//   OWNERS=10 CONTACTS_PER_OWNER=2000 npx tsx scripts/bench-tenancy.ts
//   OWNERS=25 CONTACTS_PER_OWNER=2000 npx tsx scripts/bench-tenancy.ts
// =============================================================================

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import os from "node:os";

const OWNERS = Number(process.env.OWNERS ?? 1);
const CONTACTS_PER_OWNER = Number(process.env.CONTACTS_PER_OWNER ?? 5000);
const INTERACTIONS_PER_CONTACT = Number(
  process.env.INTERACTIONS_PER_CONTACT ?? 3,
);
const ITERATIONS = Number(process.env.ITERATIONS ?? 50);

// Must be set before any server module is imported.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "contrack-bench-"));
process.env.DISABLE_BACKGROUND_JOBS = "true";
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.MAPBOX_API_KEY = "";
process.env.AUTH_REQUIRED = "true";
process.env.NODE_ENV = "test";

const http = await import("node:http");
const request = (await import("supertest")).default;
const { createApp, finalizeApp } = await import("../server/app.ts");
const { sqlite } = await import("../server/db.ts");
const authService = await import("../server/services/authService.ts");
const { contactService } = await import("../server/services/contactService.ts");
const { interactionService } =
  await import("../server/services/interactionService.ts");
const { runWithContext } = await import("../server/tenancy/requestContext.ts");
const { scopeForOwnerId } = await import("../server/tenancy/scope.ts");

const FIRST = [
  "Ada",
  "Grace",
  "Alan",
  "Katherine",
  "Linus",
  "Barbara",
  "Dennis",
  "Radia",
  "Ken",
  "Margaret",
  "Guido",
  "Anita",
  "Bjarne",
  "Shafi",
  "Tim",
  "Frances",
];
const LAST = [
  "Lovelace",
  "Hopper",
  "Turing",
  "Johnson",
  "Torvalds",
  "Liskov",
  "Ritchie",
  "Perlman",
  "Thompson",
  "Hamilton",
  "Rossum",
  "Borg",
  "Stroustrup",
  "Goldwasser",
];
const COMPANIES = [
  "Acme Corp",
  "Globex",
  "Initech",
  "Umbrella",
  "Stark Industries",
  "Tyrell",
  "Wonka Industries",
  "Cyberdyne",
  "Soylent",
  "Aperture Science",
];
const ROLES = [
  "Engineer",
  "VP Sales",
  "Designer",
  "Founder",
  "Analyst",
  "Recruiter",
];
const TAGS = ["investor", "customer", "friend", "alumni", "mentor", "vendor"];
const CITIES = ["Austin", "Berlin", "Lagos", "Osaka", "Lima", "Toronto"];

function pick<T>(list: T[], i: number): T {
  return list[i % list.length];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

interface Row {
  label: string;
  p50: number;
  p95: number;
  n: number;
  note: string;
}

async function measure(
  label: string,
  fn: () => Promise<unknown>,
  iterations = ITERATIONS,
  note = "",
): Promise<Row> {
  // One warm-up so prepared statements and caches are not charged to run 1.
  await fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    n: iterations,
    note,
  };
}

async function main(): Promise<void> {
  const app = createApp({ disableRateLimit: true });
  const server = http.createServer(finalizeApp(app));
  server.listen(0, "127.0.0.1");

  const seedStart = performance.now();
  const owners: { id: string; username: string; password: string }[] = [];

  for (let o = 0; o < OWNERS; o++) {
    const creds = {
      email: `bench${o}@example.com`,
      username: `bench${o}`,
      password: "correct horse battery staple",
      displayName: `Bench Owner ${o}`,
    };
    const user = await authService.createUser(creds);
    owners.push({
      id: user.id,
      username: creds.username,
      password: creds.password,
    });

    // Every insert runs inside that owner's scope, which is what task 0.5
    // reads. This is how production will write once Phase 1 lands.
    const scope = scopeForOwnerId(user.id);
    runWithContext(
      {
        requestId: `bench-seed-${o}`,
        principal: null,
        scope,
      },
      () => {
        for (let c = 0; c < CONTACTS_PER_OWNER; c++) {
          const contact: { id: string } | null = contactService.createContact(
            scope,
            {
              name: `${pick(FIRST, c)} ${pick(LAST, c + o)}`,
              company: pick(COMPANIES, c + o),
              role: pick(ROLES, c),
              location: pick(CITIES, c),
              tags: [pick(TAGS, c), pick(TAGS, c + 1)],
            } as never,
          );
          if (!contact) continue;
          for (let n = 0; n < INTERACTIONS_PER_CONTACT; n++) {
            interactionService.createInteraction(contact.id, {
              type: "note",
              title: `Touchpoint ${n}`,
              content: `Discussed roadmap and budget, round ${n}.`,
            } as never);
          }
        }
      },
    );
    process.stderr.write(
      `  seeded owner ${o + 1}/${OWNERS} (${CONTACTS_PER_OWNER} contacts)\n`,
    );
  }
  const seedMs = performance.now() - seedStart;

  // Measure as the first owner, signed in the way a browser is.
  const login = await request(server)
    .post("/api/auth/login")
    .send({ identifier: owners[0].username, password: owners[0].password });
  const cookie = (login.headers["set-cookie"] as unknown as string[]) ?? [];
  if (!cookie.length) {
    throw new Error(`bench: login failed with ${login.status}`);
  }
  const auth = (r: import("supertest").Test): import("supertest").Test =>
    r.set("Cookie", cookie);
  const sampleId = (
    sqlite.prepare("SELECT id FROM contacts LIMIT 1").get() as { id: string }
  ).id;

  const rows: Row[] = [];
  rows.push(
    await measure("GET /api/contacts?view=slim", () =>
      auth(request(server).get("/api/contacts?view=slim")).expect(200),
    ),
  );
  rows.push(
    await measure("GET /api/contacts/:id", () =>
      auth(request(server).get(`/api/contacts/${sampleId}`)).expect(200),
    ),
  );
  rows.push(
    await measure("GET /api/search?q=", () =>
      auth(request(server).get("/api/search?q=Acme")).expect(200),
    ),
  );
  rows.push(
    await measure(
      "POST /api/search/semantic",
      () =>
        auth(
          request(server).post("/api/search/semantic").send({ query: "Acme" }),
        ),
      ITERATIONS,
      "mock AI, so this is FTS plus vector",
    ),
  );
  rows.push(
    await measure("GET /api/dashboard", () =>
      auth(request(server).get("/api/dashboard")).expect(200),
    ),
  );
  rows.push(
    await measure("GET /api/command-palette/zero-state", () =>
      auth(request(server).get("/api/command-palette/zero-state")).expect(200),
    ),
  );
  rows.push(
    await measure("GET /api/contacts/:id/timeline", () =>
      auth(request(server).get(`/api/contacts/${sampleId}/timeline`)).expect(
        200,
      ),
    ),
  );
  rows.push(
    await measure("GET /api/action-items", () =>
      auth(request(server).get("/api/action-items")).expect(200),
    ),
  );
  rows.push(
    await measure(
      "PATCH /api/contacts/:id",
      () =>
        auth(
          request(server)
            .patch(`/api/contacts/${sampleId}`)
            .send({ role: `Role ${Math.random().toString(36).slice(2, 8)}` }),
        ),
      Math.min(ITERATIONS, 20),
      "one FTS trigger delete plus reinsert per update",
    ),
  );
  rows.push(
    await measure(
      "POST /api/dedupe/scan",
      () => auth(request(server).post("/api/dedupe/scan").send({})),
      3,
      "wall time, mock AI",
    ),
  );

  const vec = sqlite.prepare("SELECT vec_version() AS v").get() as {
    v: string;
  };
  const sqliteVersion = sqlite
    .prepare("SELECT sqlite_version() AS v")
    .get() as {
    v: string;
  };
  const totalContacts = (
    sqlite.prepare("SELECT COUNT(*) AS n FROM contacts").get() as { n: number }
  ).n;

  const out: string[] = [];
  out.push(
    `# Tenancy benchmark: ${OWNERS} owner(s) x ${CONTACTS_PER_OWNER} contacts`,
  );
  out.push("");
  out.push(
    `- Machine: ${os.cpus()[0]?.model ?? "unknown"}, ${os.cpus().length} cores, ${(os.totalmem() / 1e9).toFixed(0)} GB`,
  );
  out.push(`- Platform: ${process.platform} ${os.release()} (${process.arch})`);
  out.push(`- Node: ${process.version}`);
  out.push(`- SQLite: ${sqliteVersion.v}`);
  out.push(`- sqlite-vec: ${vec.v}`);
  out.push(`- Contacts in the database: ${totalContacts}`);
  out.push(`- Interactions per contact: ${INTERACTIONS_PER_CONTACT}`);
  out.push(`- Seed time: ${(seedMs / 1000).toFixed(1)}s`);
  out.push(
    `- Measured as one signed-in owner, ${ITERATIONS} iterations unless noted.`,
  );
  out.push("");
  out.push("| Endpoint | p50 ms | p95 ms | n | Note |");
  out.push("| -------- | -----: | -----: | -: | ---- |");
  for (const r of rows) {
    out.push(
      `| \`${r.label}\` | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.n} | ${r.note} |`,
    );
  }
  out.push("");

  console.log(out.join("\n"));
  server.close();
  sqlite.close();
}

await main();

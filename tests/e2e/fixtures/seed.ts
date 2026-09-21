/**
 * The people and notes every open instance starts with.
 *
 * Written through the same routes the app uses, so what the browser finds is
 * what the server would have stored for anybody. Small on purpose: six
 * people is enough for a list, a detail view, a search with results and a
 * search without, and few enough that a test can name what it expects.
 *
 * The notes are dated relative to today. Two mention hiring inside the last
 * thirty days and one mentions it long before, so "hiring" in the notes
 * search finds three and "hiring" in the last 30 days finds two.
 */
import type { ContrackInstance } from "./instance";

export interface SeedNote {
  type: "note" | "call" | "meeting" | "email";
  title: string;
  content: string;
  daysAgo: number;
}

export interface SeedPerson {
  name: string;
  role: string;
  company: string;
  location: string;
  /**
   * Where the map pins them. Set here because the suite runs with background
   * jobs off, so the geocoder never fills these in, and it must not reach a
   * public geocoder from CI anyway.
   */
  lat: number;
  lng: number;
  email: string;
  notes: SeedNote[];
}

export const PEOPLE: readonly SeedPerson[] = [
  {
    name: "Ada Lovelace",
    role: "Analytical Engineer",
    company: "Babbage & Co",
    location: "London, UK",
    lat: 51.5074,
    lng: -0.1278,
    email: "ada@example.com",
    notes: [
      {
        type: "meeting",
        title: "Coffee about the Berlin office",
        content:
          "Discussed hiring plans for the Berlin office. Ada wants two engineers by spring.",
        daysAgo: 12,
      },
    ],
  },
  {
    name: "Grace Hopper",
    role: "Rear Admiral",
    company: "US Navy",
    location: "Arlington, VA",
    lat: 38.8816,
    lng: -77.091,
    email: "grace@example.com",
    notes: [
      {
        type: "call",
        title: "Compiler team",
        content:
          "Grace is hiring a compiler team lead this quarter. She asked for introductions.",
        daysAgo: 20,
      },
    ],
  },
  {
    name: "Edsger Dijkstra",
    role: "Professor",
    company: "UT Austin",
    location: "Austin, TX",
    lat: 30.2672,
    lng: -97.7431,
    email: "edsger@example.com",
    notes: [
      {
        type: "note",
        title: "Shortest path",
        content:
          "We argued about goto for an hour. He mentioned hiring a postdoc last year.",
        daysAgo: 400,
      },
    ],
  },
  {
    name: "Katherine Johnson",
    role: "Mathematician",
    company: "NASA",
    location: "Hampton, VA",
    lat: 37.0299,
    lng: -76.3452,
    email: "katherine@example.com",
    notes: [
      {
        type: "email",
        title: "Trajectory review",
        content: "Sent the launch window numbers for the review on Thursday.",
        daysAgo: 3,
      },
    ],
  },
  {
    name: "Linus Torvalds",
    role: "Fellow",
    company: "Linux Foundation",
    location: "Portland, OR",
    lat: 45.5152,
    lng: -122.6784,
    email: "linus@example.com",
    notes: [],
  },
  {
    name: "Margaret Hamilton",
    role: "CEO",
    company: "Hamilton Technologies",
    location: "Cambridge, MA",
    lat: 42.3736,
    lng: -71.1097,
    email: "margaret@example.com",
    notes: [
      {
        type: "meeting",
        title: "Apollo retrospective",
        content: "Walked through the priority scheduling story over lunch.",
        daysAgo: 60,
      },
    ],
  },
];

/**
 * The people a test account keeps up with. Four of six: Edsger (400 days
 * quiet, so At risk), Ada, Grace and Katherine (scored). Linus (no notes)
 * and Margaret stay untracked, so every spec has both states to look at.
 */
export const TRACKED: ReadonlySet<string> = new Set([
  "Ada Lovelace",
  "Grace Hopper",
  "Edsger Dijkstra",
  "Katherine Johnson",
]);

export interface SeededContact {
  id: string;
  name: string;
}

export interface Seed {
  /** In the order of {@link PEOPLE}, which is also alphabetical by name. */
  contacts: SeededContact[];
  byName: (name: string) => SeededContact;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCHours(10, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/** Write {@link PEOPLE} into an open instance through its API. */
export async function seedInstance(instance: ContrackInstance): Promise<Seed> {
  const contacts: SeededContact[] = [];
  for (const person of PEOPLE) {
    const created = await instance.api<{ id: string; name: string }>(
      "POST",
      "/contacts",
      {
        name: person.name,
        role: person.role,
        company: person.company,
        location: person.location,
        lat: person.lat,
        lng: person.lng,
        emails: [{ email: person.email, label: "work", isPrimary: true }],
      },
    );
    contacts.push({ id: created.id, name: created.name });
    for (const note of person.notes) {
      await instance.api("POST", `/contacts/${created.id}/interactions`, {
        type: note.type,
        title: note.title,
        content: note.content,
        date: daysAgoIso(note.daysAgo),
      });
    }
    // Tracked last, after the notes, so the score the route computes on the
    // flip reads the interactions it has.
    if (TRACKED.has(person.name)) {
      await instance.api("PATCH", `/contacts/${created.id}`, {
        isTracked: true,
      });
    }
  }
  return {
    contacts,
    byName: (name) => {
      const hit = contacts.find((c) => c.name === name);
      if (!hit) throw new Error(`No seeded contact named ${name}`);
      return hit;
    },
  };
}

import "dotenv/config";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/db/schema";
import { faker } from "@faker-js/faker";
import crypto from "crypto";

// Same resolution as server/db.ts — see the note in seed.ts.
const DB_PATH = path.join(process.env.DATA_DIR ?? process.cwd(), "curator.db");
const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite, { schema });

// Pre-defined set of cities to give good map distribution
const CITIES = [
  { location: "San Francisco, CA", lat: 37.7749, lng: -122.4194 },
  { location: "New York, NY", lat: 40.7128, lng: -74.006 },
  { location: "London, UK", lat: 51.5074, lng: -0.1278 },
  { location: "Tokyo, Japan", lat: 35.6762, lng: 139.6503 },
  { location: "Sydney, Australia", lat: -33.8688, lng: 151.2093 },
  { location: "Paris, France", lat: 48.8566, lng: 2.3522 },
  { location: "Berlin, Germany", lat: 52.52, lng: 13.405 },
  { location: "Toronto, Canada", lat: 43.6532, lng: -79.3832 },
  { location: "Singapore", lat: 1.3521, lng: 103.8198 },
  { location: "Dubai, UAE", lat: 25.2048, lng: 55.2708 },
  { location: "Austin, TX", lat: 30.2672, lng: -97.7431 },
  { location: "Miami, FL", lat: 25.7617, lng: -80.1918 },
  { location: "Seattle, WA", lat: 47.6062, lng: -122.3321 },
  { location: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  { location: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
];

const THEME_COLORS = [
  "brand",
  "rose",
  "amber",
  "emerald",
  "cyan",
  "blue",
  "violet",
  "pink",
  "orange",
  "slate",
];
const INDUSTRIES = [
  "Enterprise Software",
  "Venture Capital",
  "Healthcare & AI",
  "Fintech",
  "Consumer Goods",
  "Legal",
  "Hardware",
  "Music Streaming",
  "Space Tech",
  "Quantum Computing",
];

const FIRST_NAMES = [
  "James",
  "Mary",
  "Robert",
  "Patricia",
  "John",
  "Jennifer",
  "Michael",
  "Linda",
  "David",
  "Elizabeth",
  "William",
  "Barbara",
  "Richard",
  "Susan",
  "Joseph",
  "Jessica",
  "Thomas",
  "Sarah",
  "Charles",
  "Karen",
  "Christopher",
  "Lisa",
  "Daniel",
  "Nancy",
  "Matthew",
  "Betty",
  "Anthony",
  "Margaret",
  "Mark",
  "Sandra",
  "Alex",
  "Ryan",
  "Tyler",
  "Jacob",
  "Nicholas",
  "Ethan",
  "Zachary",
  "Dylan",
];

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
  "Harris",
  "Sanchez",
  "Clark",
  "Ramirez",
  "Lewis",
  "Robinson",
  "Walker",
];

const COMPANIES = [
  "Acme Corp",
  "TechNova",
  "Global Dynamics",
  "Stark Industries",
  "Wayne Enterprises",
  "Initech",
  "Umbrella Corp",
  "Cyberdyne Systems",
  "Hooli",
  "Pied Piper",
  "Massive Dynamic",
  "Vandelay Industries",
  "Soylent Corp",
  "Bluth Company",
  "Dunder Mifflin",
  "Aperture Science",
  "Black Mesa",
  "Omni Consumer Products",
  "Nexus Solutions",
  "Aurora Analytics",
  "Zenith Software",
  "Horizon Digital",
];

const ROLES = [
  "Product Manager",
  "Software Engineer",
  "Designer",
  "Data Scientist",
  "CEO",
  "CTO",
  "Founder",
  "Marketing Director",
  "Sales Executive",
  "HR Manager",
  "Operations Lead",
  "Financial Analyst",
  "Consultant",
  "Project Manager",
  "Creative Director",
  "UX Researcher",
  "DevOps Engineer",
];

const ROLE_TYPES = [
  "Engineering",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "Executive",
  "Operations",
  "Finance",
  "HR",
  "Customer Success",
];

function generateContacts(count: number) {
  const contacts = [];
  // Predictable seed for reliable testing
  faker.seed(1337);

  for (let i = 0; i < count; i++) {
    const firstName = faker.helpers.arrayElement(FIRST_NAMES);
    const lastName = faker.helpers.arrayElement(LAST_NAMES);
    const city = faker.helpers.arrayElement(CITIES);
    const jobTitle = faker.helpers.arrayElement(ROLES);
    const jobType = faker.helpers.arrayElement(ROLE_TYPES);

    contacts.push({
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      headline: jobTitle,
      role: jobType,
      company: faker.helpers.arrayElement(COMPANIES),
      birthday: faker.date
        .birthdate({ min: 25, max: 60, mode: "age" })
        .toISOString()
        .split("T")[0],
      preferences: faker.helpers.arrayElement([
        "Loves async updates",
        "Prefer text messages",
        "Green tea",
        "Zoom meetings only",
        "Morning coffee syncs",
      ]),
      about: faker.helpers.arrayElement([
        `Passionate ${jobTitle} with a focus on delivering high-quality results. Always eager to learn and take on new challenges.`,
        `Experienced professional specializing in the ${faker.helpers.arrayElement(INDUSTRIES)} sector. I enjoy connecting with others and sharing insights on industry trends.`,
        `Driven ${jobType} building innovative solutions. Currently exploring new opportunities to collaborate and grow.`,
        `Strategic thinker and dedicated leader. I love turning complex problems into elegant solutions.`,
        `Forward-thinking specialist with a background in ${faker.helpers.arrayElement(INDUSTRIES)}. Let's connect and discuss how we can work together.`,
        `Creative and analytical mind bridging the gap between business needs and technical implementation.`,
        `Enthusiastic professional who loves building teams, scaling products, and driving growth in the ${faker.helpers.arrayElement(INDUSTRIES)} space.`,
        `Lifelong learner and experienced ${jobType}. Passionate about mentoring and giving back to the community.`,
      ]),
      pronouns: faker.helpers.arrayElement(["he/him", "she/her", "they/them"]),
      industry: faker.helpers.arrayElement(INDUSTRIES),
      themeColor: faker.helpers.arrayElement(THEME_COLORS),
      // Add slight jitter so multiple people in the same city don't completely overlap on the map
      lat: city.lat + (Math.random() * 0.1 - 0.05),
      lng: city.lng + (Math.random() * 0.1 - 0.05),
      location: city.location,
      emails: [
        {
          email: faker.internet.email({ firstName, lastName }),
          label: "work",
          isPrimary: 1,
        },
        faker.datatype.boolean()
          ? {
              email: faker.internet.email({
                firstName,
                lastName,
                provider: "gmail.com",
              }),
              label: "personal",
              isPrimary: 0,
            }
          : null,
      ].filter((x) => x !== null),
      phones: [{ phone: faker.phone.number(), label: "mobile", isPrimary: 1 }],
      addresses: [{ address: city.location, label: "work", isPrimary: 1 }],
      socialLinks: [
        {
          platform: "linkedin",
          url: `https://linkedin.com/in/${firstName.toLowerCase()}${lastName.toLowerCase()}`,
          handle: `${firstName}${lastName}`,
        },
        faker.datatype.boolean()
          ? {
              platform: "twitter",
              url: `https://twitter.com/${firstName.toLowerCase()}_${lastName.toLowerCase()}`,
              handle: `@${firstName}_${lastName}`,
            }
          : null,
      ].filter((x) => x !== null),
      experience: [
        {
          company: faker.helpers.arrayElement(COMPANIES),
          role: faker.helpers.arrayElement(ROLES),
          isCurrent: 1,
          startDate: faker.date.past({ years: 3 }).toISOString().split("T")[0],
        },
        {
          company: faker.helpers.arrayElement(COMPANIES),
          role: faker.helpers.arrayElement(ROLES),
          isCurrent: 0,
          startDate: faker.date.past({ years: 6 }).toISOString().split("T")[0],
          endDate: faker.date.past({ years: 3 }).toISOString().split("T")[0],
        },
      ],
      education: [
        {
          school: faker.helpers.arrayElement([
            "Stanford",
            "MIT",
            "Harvard",
            "UC Berkeley",
            "Oxford",
          ]),
          degree: faker.helpers.arrayElement(["BS", "MS", "PhD", "MBA"]),
          fieldOfStudy: faker.helpers.arrayElement([
            "Computer Science",
            "Finance",
            "Biology",
            "Economics",
            "Design",
          ]),
        },
      ],
      tags: faker.helpers.arrayElements(
        [
          "tech-lead",
          "investor",
          "academic",
          "founder",
          "engineering",
          "design",
          "close-friend",
          "advisor",
        ],
        2,
      ),
      interests: faker.helpers
        .arrayElements(
          [
            { interest: "Photography", isAiGenerated: false },
            { interest: "Hiking", isAiGenerated: false },
            { interest: "Angel Investing", isAiGenerated: false },
            { interest: "Machine Learning", isAiGenerated: true },
            { interest: "Startups", isAiGenerated: true },
            { interest: "Cooking", isAiGenerated: false },
            { interest: "Surfing", isAiGenerated: false },
            { interest: "Bouldering", isAiGenerated: false },
            { interest: "Coffee Roasting", isAiGenerated: true },
            { interest: "Reading Sci-Fi", isAiGenerated: false },
            { interest: "Cycling", isAiGenerated: false },
            { interest: "Sailing", isAiGenerated: false },
            { interest: "Pottery", isAiGenerated: true },
            { interest: "Architecture", isAiGenerated: false },
          ],
          { min: 1, max: 4 },
        )
        .map((i) => ({ ...i, isAiGenerated: faker.datatype.boolean() })),
      interactions: Array.from({
        length: faker.number.int({ min: 1, max: 6 }),
      }).map(() => ({
        type: faker.helpers.arrayElement([
          "meeting",
          "call",
          "note",
          "email",
          "message",
        ]),
        title: faker.helpers.arrayElement([
          "Discussed Q3 Roadmap",
          "Introductory call",
          "Follow up regarding partnership",
          "Sync on project deliverables",
          "Coffee chat",
          "Quarterly check-in",
          "Product demo and feedback",
          "Strategy alignment meeting",
          "Quick catch-up",
          "Discussed new opportunities",
          "Contract negotiation",
        ]),
        content: faker.helpers.arrayElement([
          "Had a great conversation about potential synergies. We agreed to reconnect next month.",
          "Shared the latest pitch deck and got some preliminary feedback. Overall very positive.",
          "Discussed their recent career move and how they are adjusting to the new role.",
          "Quick sync to clarify some points on the contract. Everything looks good to go.",
          "Sent over the requested documents. Waiting for their review and feedback.",
          "Left a voicemail to check in on their progress with the new integration.",
          "We brainstormed some ideas for the upcoming marketing campaign. Very productive session.",
          "They expressed interest in our new enterprise tier. Scheduled a follow-up demo for next week.",
          "Caught up on industry news and shared some insights on the current market trends.",
          "Reviewed the project milestones and confirmed we are on track for the target launch date.",
          "Discussed potential blockers and how to mitigate risks moving forward.",
        ]),
        date: faker.date.recent({ days: 90 }).toISOString(),
      })),
    });
  }
  return contacts;
}

const MOCK_DATA = generateContacts(30);

try {
  sqlite.transaction(() => {
    for (const c of MOCK_DATA) {
      const id = crypto.randomUUID();

      db.insert(schema.contacts)
        .values({
          id,
          name: c.name,
          firstName: c.firstName,
          lastName: c.lastName,
          headline: c.headline,
          role: c.role,
          company: c.company,
          location: c.location,
          lat: c.lat,
          lng: c.lng,
          birthday: c.birthday,
          preferences: c.preferences,
          about: c.about,
          pronouns: c.pronouns,
          industry: c.industry,
          themeColor: c.themeColor,
          // Local generation — see server/services/avatarService. Seeding must
          // not bake third-party URLs into a fresh database.
          avatarUrl: "/api/avatar/avataaars?seed=" + encodeURIComponent(c.name),
        })
        .run();

      for (const e of c.emails) {
        db.insert(schema.contactEmails)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            email: e.email,
            label: e.label,
            isPrimary: e.isPrimary,
            source: "seed",
          })
          .run();
      }
      for (const p of c.phones) {
        db.insert(schema.contactPhones)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            phone: p.phone,
            label: p.label,
            isPrimary: p.isPrimary,
            source: "seed",
          })
          .run();
      }
      for (const a of c.addresses) {
        db.insert(schema.contactAddresses)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            address: a.address,
            label: a.label,
            isPrimary: a.isPrimary,
            source: "seed",
          })
          .run();
      }
      for (const sl of c.socialLinks) {
        db.insert(schema.contactSocialLinks)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            platform: sl.platform,
            url: sl.url,
            handle: sl.handle,
            source: "seed",
          })
          .run();
      }
      for (const exp of c.experience) {
        db.insert(schema.contactExperience)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            company: exp.company,
            role: exp.role,
            isCurrent: exp.isCurrent,
            startDate: exp.startDate,
            endDate: exp.endDate,
            source: "seed",
          })
          .run();
      }
      for (const edu of c.education) {
        db.insert(schema.contactEducation)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            school: edu.school,
            degree: edu.degree,
            fieldOfStudy: edu.fieldOfStudy,
            source: "seed",
          })
          .run();
      }
      for (const t of c.tags) {
        db.insert(schema.contactTags)
          .values({ id: crypto.randomUUID(), contactId: id, tag: t })
          .run();
      }
      for (const i of c.interests) {
        db.insert(schema.contactInterests)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            interest: i.interest,
            isAiGenerated: i.isAiGenerated,
          })
          .run();
      }
      for (const int of c.interactions) {
        db.insert(schema.interactions)
          .values({
            id: crypto.randomUUID(),
            contactId: id,
            type: int.type,
            title: int.title,
            content: int.content,
            date: int.date,
          })
          .run();
      }
    }
  })();
  console.log(
    "✅ Successfully injected 30 rich mock contacts into the database.",
  );
} catch (e) {
  console.error(
    "⚠️ Failed to inject mocks:",
    e instanceof Error ? e.message : String(e),
  );
}

import "dotenv/config";
import * as schema from "../src/db/schema.ts";
// The server's own database module, not a private connection: this resolves
// DATA_DIR identically to the app AND runs migrations on import, so seeding
// a brand-new data directory works instead of dying on "no such table".
// (The old private connection hardcoded ./curator.db — on a DATA_DIR install
// it seeded a stray database the app never reads.)
import { db, sqlite } from "../server/db.ts";

const contactCount = sqlite
  .prepare("SELECT COUNT(*) as count FROM contacts")
  .get() as { count: number };

if (contactCount.count === 0) {
  const julianId = "julian-thorne";

  try {
    db.insert(schema.contacts)
      .values({
        id: julianId,
        name: "Julian Thorne",
        firstName: "Julian",
        lastName: "Thorne",
        headline: "Creative Director & Brand Strategist",
        role: "Creative Director",
        company: "Nexus Design Labs",
        location: "Copenhagen, Denmark",
        birthday: "1985-05-12",
        preferences: "Single-origin espresso",
        avatarUrl:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuBHMk5ZdBFriHiUZujq7KGt4eWmlY8AJg3NkqVmmbfehPWOpZzOuCrSwtOg3QzxjCuYECSx9OHMdH91lagfdbIQie9TzqTTpYrVlnJeW5UiA2ySfWrk1L0Ynzq2Ws2bM4jeUiUM42vXHz1Frud7ePF4bFb9643_YqYsjS0mlna6yaBj5R--9S4HGEq4G5Khxxq0raILPfdJ66fLRp7NJjbSg1AiAUYKSi_Nsyts0nt5Zno78SMmxUjOCnWmFj4R7iQMV2EDrEdziE4",
        industry: "Design",
        cadenceDays: 90,
      })
      .run();

    db.insert(schema.contactEmails)
      .values({
        id: crypto.randomUUID(),
        contactId: julianId,
        email: "julian@nexus.design",
        label: "work",
        isPrimary: 1,
        source: "manual",
      })
      .run();

    db.insert(schema.contactPhones)
      .values({
        id: crypto.randomUUID(),
        contactId: julianId,
        phone: "+1 (555) 012-3456",
        label: "mobile",
        isPrimary: 1,
        source: "manual",
      })
      .run();

    db.insert(schema.contactSources)
      .values({
        id: crypto.randomUUID(),
        contactId: julianId,
        platform: "manual",
        importedAt: new Date().toISOString(),
      })
      .run();

    db.insert(schema.contactSocialLinks)
      .values([
        {
          id: crypto.randomUUID(),
          contactId: julianId,
          platform: "linkedin",
          url: "https://linkedin.com/in/julianthorne",
          handle: "julianthorne",
          source: "manual",
        },
        {
          id: crypto.randomUUID(),
          contactId: julianId,
          platform: "twitter",
          url: "https://twitter.com/julian_designs",
          handle: "@julian_designs",
          source: "manual",
        },
        {
          id: crypto.randomUUID(),
          contactId: julianId,
          platform: "github",
          url: "https://github.com/nexus-julian",
          handle: "nexus-julian",
          source: "manual",
        },
        {
          id: crypto.randomUUID(),
          contactId: julianId,
          platform: "website",
          url: "https://nexus.design",
          handle: "nexus.design",
          source: "manual",
        },
      ])
      .run();

    db.insert(schema.interactions)
      .values([
        {
          id: "note-1",
          contactId: julianId,
          type: "note",
          title: "Nexus Project Phase 1",
          content:
            "Discussed the upcoming rebranding. Julian is particularly concerned about the mobile responsiveness of the typography. He mentioned 'Inter' as a potential base font.",
          date: "2023-10-12T10:00:00Z",
        },
        {
          id: "activity-1",
          contactId: julianId,
          type: "call",
          title: "Follow-up Call",
          duration: "14 mins",
          date: "2023-10-21T14:30:00Z",
        },
      ])
      .run();

    console.log(
      "✅ Seed complete: Inserted default seed contact (Julian Thorne)",
    );
  } catch (e) {
    console.warn("⚠️ Seed insertion skipped", {
      reason: e instanceof Error ? e.message : String(e),
    });
  }
} else {
  console.log(
    `ℹ️ Database already has ${contactCount.count} contact(s) — skipping seed`,
  );
}

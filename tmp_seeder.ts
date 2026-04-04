import { sqlite } from "./server/db.js";
import { contactRepo } from "./server/repositories/contactRepository.js";
import crypto from "crypto";

const contactId = crypto.randomUUID();

// Core Contact
sqlite.prepare(`
  INSERT INTO contacts (
    id, name, company, role, aiSummary, aiBackground, aiHydratedAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  contactId,
  "Sean Pais",
  "Texas Instruments",
  "Planning Director",
  "Director of Distribution Planning at Texas Instruments, shifting his focus through MBA coursework toward marketing and specialized consulting.",
  `Sean has a notable academic trajectory that heavily influences his ongoing professional development.

### Graduate Studies (Current)
He is actively pursuing a Master of Business Administration (MBA)—a graduate degree focused on business management, organizational behavior, and leadership—at the University of Texas at Austin's McCombs School of Business. He is enrolled in the Dallas Working Professional MBA program as part of the Class of 2026. This specific program structure allows professionals to maintain their current, full-time corporate roles while completing their graduate coursework on weekends or evenings.

### Recent Strategic Projects
Sean has recently been highlighted by the University of Texas for his participation in hands-on, micro-consulting engagements known as **"McCombs+ Projects."** He worked as a student consultant for Rentsch Brewery, a small craft beer operation located in Georgetown, Texas.

His team's primary objective was to develop a comprehensive marketing strategy designed to increase the brewery's physical taproom sales. This required shifting his focus away from the massive corporate supply chains of Texas Instruments to the distinct operational realities of a small, local business.`,
  new Date().toISOString()
);

const payload = {
  interests: [
    { interest: "Long-distance running", isAiGenerated: true },
    { interest: "Cross-country", isAiGenerated: true }
  ],
  attributes: [
    { name: "Key Insights", value: "During this project, Sean realized that a successful consultant must actively understand and navigate interpersonal relationship dynamics (change management)." },
    { name: "Evolving Career Interests", value: "Through his consulting project with the brewery, he discovered a previously unexpected passion for marketing and entrepreneurship." }
  ],
  education: [
    { school: "UT Austin (McCombs)", degree: "MBA", startDate: "2024", endDate: "2026" },
    { school: "West Windsor-Plainsboro HS", startDate: "2005", endDate: "2009" }
  ]
};

contactRepo.insertChildRecords(contactId, payload, "AI Hydration Script");
console.log("Seeded Sean Pais! Contact ID:", contactId);

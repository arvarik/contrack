import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/db/schema";

const DB_PATH = "curator.db";
const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite, { schema });

const MOCK_DATA = [
  {
    name: "Elena Rostova",
    firstName: "Elena",
    lastName: "Rostova",
    headline: "VP of Engineering at CloudMatrix",
    role: "VP Engineering",
    company: "CloudMatrix",
    birthday: "1988-11-20",
    preferences: "Green tea, early morning meetings",
    about:
      "Passionate about distributed systems and cloud native architectures. Leads a team of 150 engineers.",
    pronouns: "she/her",
    industry: "Enterprise Software",
    themeColor: "rose",
    lat: 40.7128,
    lng: -74.006,
    location: "New York, NY",
    emails: [
      { email: "elena.rostova@cloudmatrix.io", label: "work", isPrimary: 1 },
    ],
    phones: [{ phone: "+1 (212) 555-0198", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "New York, NY", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "linkedin",
        url: "https://linkedin.com/in/erostova",
        handle: "erostova",
      },
    ],
    experience: [
      {
        company: "CloudMatrix",
        role: "VP Engineering",
        isCurrent: 1,
        startDate: "2020-01-01",
      },
    ],
    education: [
      { school: "MIT", degree: "MS", fieldOfStudy: "Computer Science" },
    ],
    tags: ["tech-lead", "nyc-network"],
    interests: [
      { interest: "Distributed Systems", isAiGenerated: false },
      { interest: "Marathon Running", isAiGenerated: true },
    ],
    interactions: [
      {
        type: "meeting",
        title: "Cloud Architecture Review",
        content: "Discussed the new k8s deployment strategy.",
        date: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
  },
  {
    name: "Marcus Sterling",
    firstName: "Marcus",
    lastName: "Sterling",
    headline: "Founding Partner @ Sterling Capital",
    role: "Partner",
    company: "Sterling Capital",
    birthday: "1975-03-15",
    preferences: "Sparkling water, formal dinners",
    about:
      "Early stage investor specializing in B2B SaaS and hard tech. Based in the valley but travels frequently.",
    pronouns: "he/him",
    industry: "Venture Capital",
    themeColor: "amber",
    lat: 37.4419,
    lng: -122.143,
    location: "Palo Alto, CA",
    emails: [
      { email: "marcus@sterling.vc", label: "work", isPrimary: 1 },
      { email: "msterling75@gmail.com", label: "personal", isPrimary: 0 },
    ],
    phones: [{ phone: "+1 (650) 555-8822", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "Palo Alto, CA", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "twitter",
        url: "https://twitter.com/marcus_sterling",
        handle: "@marcus_sterling",
      },
    ],
    experience: [
      {
        company: "Sterling Capital",
        role: "Founding Partner",
        isCurrent: 1,
        startDate: "2010-06-01",
      },
    ],
    education: [
      { school: "Stanford University", degree: "MBA", fieldOfStudy: "Finance" },
    ],
    tags: ["investor", "series-a"],
    interests: [
      { interest: "Golf", isAiGenerated: false },
      { interest: "Vintage Watches", isAiGenerated: true },
    ],
    interactions: [
      {
        type: "call",
        title: "Q3 Deal Flow Sync",
        content: "Marcus is looking for AI startups with actual ARR.",
        date: new Date(Date.now() - 500000000).toISOString(),
      },
    ],
  },
  {
    name: "Dr. Sarah Chen",
    firstName: "Sarah",
    lastName: "Chen",
    headline: "Head of AI Research",
    role: "Head of AI",
    company: "NeuroTech Labs",
    birthday: "1992-08-05",
    preferences: "Zoom preferred, async async async",
    about:
      "Former deepmind researcher, now leading applied biomedical AI models at NeuroTech.",
    pronouns: "she/her",
    industry: "Healthcare & AI",
    themeColor: "violet",
    lat: 42.3601,
    lng: -71.0589,
    location: "Boston, MA",
    emails: [{ email: "schen@neurotech.ai", label: "work", isPrimary: 1 }],
    phones: [],
    addresses: [{ address: "Boston, MA", label: "home", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "github",
        url: "https://github.com/chen-ai",
        handle: "chen-ai",
      },
    ],
    experience: [
      {
        company: "NeuroTech Labs",
        role: "Head of AI",
        isCurrent: 1,
        startDate: "2021-09-01",
      },
    ],
    education: [
      { school: "Harvard", degree: "PhD", fieldOfStudy: "Neuroscience" },
    ],
    tags: ["academic", "ai-research"],
    interests: [
      { interest: "Computational Biology", isAiGenerated: false },
      { interest: "Bouldering", isAiGenerated: true },
    ],
    interactions: [
      {
        type: "note",
        title: "Read her latest paper",
        content:
          "Read 'Attention in Biomolecular structures'. Highly relevant to our new product.",
        date: new Date(Date.now() - 100000).toISOString(),
      },
    ],
  },
  {
    name: "Jameson Dubois",
    firstName: "Jameson",
    lastName: "Dubois",
    headline: "Chief Marketing Officer",
    role: "CMO",
    company: "Aura Lifestyle",
    birthday: "1980-02-14",
    preferences: "Phone calls only",
    about:
      "Creative powerhouse behind the Aura rebrand. Has an incredible eye for minimalist aesthetics.",
    pronouns: "he/him",
    industry: "Consumer Goods",
    themeColor: "orange",
    lat: 48.8566,
    lng: 2.3522,
    location: "Paris, France",
    emails: [{ email: "j.dubois@aura.fr", label: "work", isPrimary: 1 }],
    phones: [{ phone: "+33 6 12 34 56 78", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "Paris, France", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "linkedin",
        url: "https://linkedin.com/in/jdubois",
        handle: "jdubois",
      },
    ],
    experience: [
      {
        company: "Aura Lifestyle",
        role: "CMO",
        isCurrent: 1,
        startDate: "2018-03-01",
      },
    ],
    education: [],
    tags: ["marketing", "eu-contact"],
    interests: [
      { interest: "Modern Art", isAiGenerated: false },
      { interest: "Sailing", isAiGenerated: false },
    ],
    interactions: [
      {
        type: "call",
        title: "Brand synergy",
        content: "Talked about potential co-branding opportunities.",
        date: new Date(Date.now() - 8600000).toISOString(),
      },
    ],
  },
  {
    name: "Amit Patel",
    firstName: "Amit",
    lastName: "Patel",
    headline: "Senior Staff Engineer, Platform",
    role: "Senior Staff",
    company: "Stripe",
    birthday: "1990-07-22",
    preferences: "Slack or text",
    about:
      "Scale expert. Built the core ledger systems that process billions daily.",
    pronouns: "he/him",
    industry: "Fintech",
    themeColor: "blue",
    lat: 37.7749,
    lng: -122.4194,
    location: "San Francisco, CA",
    emails: [{ email: "amit.p@stripe.com", label: "work", isPrimary: 1 }],
    phones: [{ phone: "+1 (415) 555-0999", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "San Francisco, CA", label: "home", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "twitter",
        url: "https://twitter.com/apatel_eng",
        handle: "@apatel_eng",
      },
    ],
    experience: [
      {
        company: "Stripe",
        role: "Senior Staff Engineer",
        isCurrent: 1,
        startDate: "2016-08-01",
      },
    ],
    education: [{ school: "UC Berkeley", degree: "BS", fieldOfStudy: "EECS" }],
    tags: ["fintech", "engineering-leadership"],
    interests: [
      { interest: "Distributed Systems", isAiGenerated: true },
      { interest: "Photography", isAiGenerated: false },
    ],
    interactions: [
      {
        type: "meeting",
        title: "Coffee at Blue Bottle",
        content:
          "Caught up on the latest fintech trends and ledger architectures.",
        date: new Date().toISOString(),
      },
    ],
  },
  {
    name: "Sophia Martinez",
    firstName: "Sophia",
    lastName: "Martinez",
    headline: "Director of Product",
    role: "Director of Product",
    company: "Spotify",
    birthday: "1987-12-05",
    preferences: "Loves async updates and brief syncs",
    about: "Leads the core algorithmic playlist discovery team.",
    pronouns: "she/her",
    industry: "Music Streaming",
    themeColor: "green",
    lat: 59.3293,
    lng: 18.0686,
    location: "Stockholm, Sweden",
    emails: [{ email: "smartinez@spotify.com", label: "work", isPrimary: 1 }],
    phones: [],
    addresses: [],
    socialLinks: [
      {
        platform: "linkedin",
        url: "https://linkedin.com/in/smartinez",
        handle: "smartinez",
      },
    ],
    experience: [
      {
        company: "Spotify",
        role: "Director of Product",
        isCurrent: 1,
        startDate: "2019-01-01",
      },
    ],
    education: [],
    tags: ["product", "music"],
    interests: [
      { interest: "DJing", isAiGenerated: false },
      { interest: "Vinyl Collection", isAiGenerated: true },
    ],
    interactions: [],
  },
  {
    name: "Liam O'Connor",
    firstName: "Liam",
    lastName: "O'Connor",
    headline: "Founder & CEO",
    role: "CEO",
    company: "BuildKite",
    birthday: "1983-04-10",
    preferences: "In-person chats when flying through",
    about: "Bootstrapped a massive dev tools company out of Australia.",
    pronouns: "he/him",
    industry: "DevTools",
    themeColor: "emerald",
    lat: -33.8688,
    lng: 151.2093,
    location: "Sydney, Australia",
    emails: [{ email: "liam@buildkite.com", label: "work", isPrimary: 1 }],
    phones: [{ phone: "+61 400 000 000", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "Sydney, Australia", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "twitter",
        url: "https://twitter.com/liamoc",
        handle: "@liamoc",
      },
    ],
    experience: [
      {
        company: "BuildKite",
        role: "CEO",
        isCurrent: 1,
        startDate: "2013-01-01",
      },
    ],
    education: [],
    tags: ["founder", "bootstrapped"],
    interests: [
      { interest: "Surfing", isAiGenerated: false },
      { interest: "Coffee Roasting", isAiGenerated: true },
    ],
    interactions: [
      {
        type: "meeting",
        title: "Dinner in SF",
        content: "Met up when he was visiting SF. Talked about CI/CD trends.",
        date: new Date(Date.now() - 30000000).toISOString(),
      },
    ],
  },
  {
    name: "Aisha Patel",
    firstName: "Aisha",
    lastName: "Patel",
    headline: "Machine Learning Researcher",
    role: "Researcher",
    company: "OpenAI",
    birthday: "1995-10-18",
    preferences: "Signal messenger",
    about: "Working on generative alignment and safety protocols.",
    pronouns: "she/her",
    industry: "Artificial Intelligence",
    themeColor: "violet",
    lat: 37.7749,
    lng: -122.4194,
    location: "San Francisco, CA",
    emails: [{ email: "aisha@openai.com", label: "work", isPrimary: 1 }],
    phones: [{ phone: "+1 (415) 555-0011", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "San Francisco, CA", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "github",
        url: "https://github.com/aisha-ml",
        handle: "aisha-ml",
      },
    ],
    experience: [
      {
        company: "OpenAI",
        role: "ML Researcher",
        isCurrent: 1,
        startDate: "2022-05-01",
      },
    ],
    education: [
      { school: "MIT", degree: "PhD", fieldOfStudy: "Computer Science" },
    ],
    tags: ["ai", "alignment", "sf"],
    interests: [
      { interest: "Ethics", isAiGenerated: true },
      { interest: "Climbing", isAiGenerated: false },
    ],
    interactions: [],
  },
  {
    name: "Kenji Sato",
    firstName: "Kenji",
    lastName: "Sato",
    headline: "Chief Operations Officer",
    role: "COO",
    company: "Robotics Inc",
    birthday: "1978-06-25",
    preferences: "Structured emails with clear steps",
    about: "Expert in hardware supply chain management.",
    pronouns: "he/him",
    industry: "Hardware",
    themeColor: "slate",
    lat: 35.6762,
    lng: 139.6503,
    location: "Tokyo, Japan",
    emails: [{ email: "ksato@robotics.jp", label: "work", isPrimary: 1 }],
    phones: [],
    addresses: [{ address: "Tokyo, Japan", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "linkedin",
        url: "https://linkedin.com/in/kenjisato",
        handle: "kenjisato",
      },
    ],
    experience: [
      {
        company: "Robotics Inc",
        role: "COO",
        isCurrent: 1,
        startDate: "2015-08-01",
      },
    ],
    education: [],
    tags: ["hardware", "logistics"],
    interests: [
      { interest: "Cycling", isAiGenerated: false },
      { interest: "Mechanical Keyboards", isAiGenerated: true },
    ],
    interactions: [
      {
        type: "email",
        title: "Supply chain intro",
        content: "Introduced Kenji to our manufacturing partner.",
        date: new Date(Date.now() - 5000000).toISOString(),
      },
    ],
  },
  {
    name: "Emily Thorne",
    firstName: "Emily",
    lastName: "Thorne",
    headline: "Head of Developer Relations",
    role: "Head of DevRel",
    company: "Vercel",
    birthday: "1991-01-30",
    preferences: "Twitter DMs",
    about:
      "Builds massive developer communities and amazing open source tooling features.",
    pronouns: "she/her",
    industry: "Developer Tools",
    themeColor: "dark",
    lat: 40.7128,
    lng: -74.006,
    location: "New York, NY",
    emails: [{ email: "emily@vercel.com", label: "work", isPrimary: 1 }],
    phones: [],
    addresses: [],
    socialLinks: [
      {
        platform: "twitter",
        url: "https://twitter.com/emily_codes",
        handle: "@emily_codes",
      },
    ],
    experience: [
      {
        company: "Vercel",
        role: "Head of DevRel",
        isCurrent: 1,
        startDate: "2021-02-01",
      },
    ],
    education: [],
    tags: ["devrel", "frontend"],
    interests: [
      { interest: "React", isAiGenerated: true },
      { interest: "Pottery", isAiGenerated: false },
    ],
    interactions: [
      {
        type: "meeting",
        title: "Conference Sync",
        content: "Met at Next.js conf to discuss community initiatives.",
        date: new Date(Date.now() - 9000000).toISOString(),
      },
    ],
  },
  {
    name: "Carlos Rivera",
    firstName: "Carlos",
    lastName: "Rivera",
    headline: "Senior Partner",
    role: "Partner",
    company: "Rivera Law Firm",
    birthday: "1968-09-12",
    preferences: "Phone checks, formal documentation",
    about: "Highly respected corporate attorney focusing on M&A and IP.",
    pronouns: "he/him",
    industry: "Legal",
    themeColor: "red",
    lat: 25.7617,
    lng: -80.1918,
    location: "Miami, FL",
    emails: [{ email: "carlos@riveralaw.com", label: "work", isPrimary: 1 }],
    phones: [{ phone: "+1 (305) 555-1234", label: "work", isPrimary: 1 }],
    addresses: [{ address: "Miami, FL", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "linkedin",
        url: "https://linkedin.com/in/criveralaw",
        handle: "criveralaw",
      },
    ],
    experience: [
      {
        company: "Rivera Law Firm",
        role: "Partner",
        isCurrent: 1,
        startDate: "2005-01-01",
      },
    ],
    education: [
      { school: "Yale Law School", degree: "JD", fieldOfStudy: "Law" },
    ],
    tags: ["legal", "advisor"],
    interests: [{ interest: "Sailing", isAiGenerated: false }],
    interactions: [
      {
        type: "call",
        title: "M&A Consult",
        content: "Quick chat regarding IP transfer constraints.",
        date: new Date(Date.now() - 800000).toISOString(),
      },
    ],
  },
  {
    name: "Anita Desai",
    firstName: "Anita",
    lastName: "Desai",
    headline: "Creative Director",
    role: "Creative Director",
    company: "Vogue",
    birthday: "1982-11-28",
    preferences: "Visual presentations, mood boards",
    about:
      "Trendsetter constantly blurring the line between digital art and high fashion.",
    pronouns: "she/her",
    industry: "Fashion",
    themeColor: "pink",
    lat: 51.5074,
    lng: -0.1278,
    location: "London, UK",
    emails: [{ email: "anita.desai@vogue.co.uk", label: "work", isPrimary: 1 }],
    phones: [],
    addresses: [{ address: "London, UK", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "instagram",
        url: "https://instagram.com/anitadesign",
        handle: "@anitadesign",
      },
    ],
    experience: [
      {
        company: "Vogue",
        role: "Creative Director",
        isCurrent: 1,
        startDate: "2019-06-01",
      },
    ],
    education: [],
    tags: ["fashion", "creative"],
    interests: [
      { interest: "Typography", isAiGenerated: true },
      { interest: "Film Photography", isAiGenerated: false },
    ],
    interactions: [],
  },
  {
    name: "David Kim",
    firstName: "David",
    lastName: "Kim",
    headline: "Backend Architect",
    role: "Architect",
    company: "Netflix",
    birthday: "1989-05-19",
    preferences: "Jira tickets and pull requests",
    about: "Obsessed with microservices scaling and latency reduction.",
    pronouns: "he/him",
    industry: "Media Tech",
    themeColor: "zinc",
    lat: 37.2582,
    lng: -121.9823,
    location: "Los Gatos, CA",
    emails: [{ email: "dkim@netflix.com", label: "work", isPrimary: 1 }],
    phones: [{ phone: "+1 (408) 555-9876", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "Los Gatos, CA", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "github",
        url: "https://github.com/dkim-sys",
        handle: "dkim-sys",
      },
    ],
    experience: [
      {
        company: "Netflix",
        role: "Backend Architect",
        isCurrent: 1,
        startDate: "2017-04-01",
      },
    ],
    education: [
      {
        school: "University of Washington",
        degree: "BS",
        fieldOfStudy: "Computer Science",
      },
    ],
    tags: ["engineering", "backend"],
    interests: [
      { interest: "Rust", isAiGenerated: true },
      { interest: "Homebrewing", isAiGenerated: false },
    ],
    interactions: [
      {
        type: "message",
        title: "Rust vs Go",
        content: "Debated the merits of Rust for network proxies.",
        date: new Date(Date.now() - 40000).toISOString(),
      },
    ],
  },
  {
    name: "Chloe Dubois",
    firstName: "Chloe",
    lastName: "Dubois",
    headline: "VP of Sustainability",
    role: "VP Sustainability",
    company: "Patagonia",
    birthday: "1977-08-11",
    preferences: "Minimal screen time, focused syncs",
    about: "Driving supply chain overhaul towards zero-carbon emissions.",
    pronouns: "she/her",
    industry: "Apparel & Environment",
    themeColor: "emerald",
    lat: 34.2805,
    lng: -119.2945,
    location: "Ventura, CA",
    emails: [
      { email: "chloe.dubois@patagonia.com", label: "work", isPrimary: 1 },
    ],
    phones: [],
    addresses: [{ address: "Ventura, CA", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "linkedin",
        url: "https://linkedin.com/in/chloedubois",
        handle: "chloedubois",
      },
    ],
    experience: [
      {
        company: "Patagonia",
        role: "VP Sustainability",
        isCurrent: 1,
        startDate: "2018-09-01",
      },
    ],
    education: [
      {
        school: "Stanford",
        degree: "MS",
        fieldOfStudy: "Environmental Sciences",
      },
    ],
    tags: ["sustainability", "executive"],
    interests: [
      { interest: "Trail Running", isAiGenerated: false },
      { interest: "Zero Waste", isAiGenerated: true },
    ],
    interactions: [],
  },
  {
    name: "Jordan Hayes",
    firstName: "Jordan",
    lastName: "Hayes",
    headline: "Growth Marketer & Investor",
    role: "Angel Investor",
    company: "Self-Employed",
    birthday: "1994-03-22",
    preferences: "Telegram",
    about:
      "Ex-Uber growth marketing wizard turned prolific angel investor in consumer social.",
    pronouns: "they/them",
    industry: "Venture Capital",
    themeColor: "cyan",
    lat: 34.0522,
    lng: -118.2437,
    location: "Los Angeles, CA",
    emails: [{ email: "jordan@hayescapital.io", label: "work", isPrimary: 1 }],
    phones: [{ phone: "+1 (310) 555-5555", label: "mobile", isPrimary: 1 }],
    addresses: [{ address: "Los Angeles, CA", label: "work", isPrimary: 1 }],
    socialLinks: [
      {
        platform: "twitter",
        url: "https://twitter.com/jordanhayes",
        handle: "@jordanhayes",
      },
    ],
    experience: [
      {
        company: "Self-Employed",
        role: "Angel Investor",
        isCurrent: 1,
        startDate: "2020-01-01",
      },
      {
        company: "Uber",
        role: "Growth Lead",
        isCurrent: 0,
        startDate: "2016-01-01",
        endDate: "2020-01-01",
      },
    ],
    education: [{ school: "UCLA", degree: "BA", fieldOfStudy: "Economics" }],
    tags: ["angel", "consumer", "growth"],
    interests: [
      { interest: "Viral Economics", isAiGenerated: true },
      { interest: "Surfing", isAiGenerated: false },
    ],
    interactions: [
      {
        type: "meeting",
        title: "Pitch Day",
        content:
          "Jordan came to the demo day and loved the new social app prototype.",
        date: new Date(Date.now() - 10000000).toISOString(),
      },
    ],
  },
];

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
          avatarUrl:
            "https://api.dicebear.com/7.x/avataaars/svg?seed=" +
            encodeURIComponent(c.name) +
            "&mouth=default,smile,serious",
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
            type: int.type as any,
            title: int.title,
            content: int.content,
            date: int.date,
          })
          .run();
      }
    }
  })();
  console.log(
    "✅ Successfully injected 15 rich mock contacts into the database.",
  );
} catch (e: any) {
  console.error("⚠️ Failed to inject mocks:", e.message);
}

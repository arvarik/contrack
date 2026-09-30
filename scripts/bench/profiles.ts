/**
 * The words the benchmark contacts are made of: what people do in each
 * industry, where they studied, what they like, and what a call or a coffee
 * with them was about.
 *
 * Nothing here is a real person. Schools and streets are real places, because
 * a test contact with a believable history is more useful than one with lorem
 * ipsum. Company names are invented by joining two parts.
 *
 * @module scripts/bench/profiles
 */

/** What people in one industry do, and what they talk about. */
export interface Industry {
  roles: string[];
  /** Things they work on, as a short noun phrase. */
  focus: string[];
  /** Words for a company in this industry: "Halcyon {noun}". */
  nouns: string[];
}

const GENERAL: Industry = {
  roles: [
    "Operations Lead",
    "Program Manager",
    "Head of Partnerships",
    "Strategy Director",
    "Account Executive",
    "Product Manager",
    "Chief of Staff",
    "Managing Director",
  ],
  focus: [
    "partnerships",
    "go-to-market",
    "operations",
    "planning",
    "customer success",
    "supply chains",
  ],
  nouns: ["Partners", "Group", "Works", "Collective", "Holdings", "Studio"],
};

export const INDUSTRIES: Record<string, Industry> = {
  Robotics: {
    roles: [
      "Robotics Engineer",
      "Controls Engineer",
      "Perception Lead",
      "Staff Software Engineer",
      "Hardware Product Manager",
      "Head of Autonomy",
      "Field Applications Engineer",
    ],
    focus: [
      "warehouse automation",
      "grasp planning",
      "sensor fusion",
      "legged locomotion",
      "safety certification",
      "teleoperation",
    ],
    nouns: ["Robotics", "Dynamics", "Automation", "Machines", "Labs"],
  },
  "Real Estate": {
    roles: [
      "Broker",
      "Development Director",
      "Asset Manager",
      "Leasing Lead",
      "Property Investor",
      "Acquisitions Associate",
      "Architect-in-Residence",
    ],
    focus: [
      "mixed-use development",
      "adaptive reuse",
      "commercial leasing",
      "build-to-rent",
      "land acquisition",
      "tenant experience",
    ],
    nouns: ["Properties", "Estates", "Realty", "Development", "Capital"],
  },
  Media: {
    roles: [
      "Editor",
      "Staff Writer",
      "Producer",
      "Audience Lead",
      "Head of Content",
      "Podcast Host",
      "Documentary Director",
    ],
    focus: [
      "long-form reporting",
      "audio storytelling",
      "newsletters",
      "video series",
      "audience growth",
      "investigations",
    ],
    nouns: ["Media", "Press", "Studios", "Broadcasting", "Pictures"],
  },
  Legal: {
    roles: [
      "Partner",
      "Associate General Counsel",
      "Privacy Counsel",
      "Litigation Associate",
      "Legal Operations Manager",
      "Patent Attorney",
      "Compliance Director",
    ],
    focus: [
      "data protection",
      "venture financings",
      "employment law",
      "IP licensing",
      "regulatory strategy",
      "commercial contracts",
    ],
    nouns: ["LLP", "Law", "Legal", "Chambers", "Advisory"],
  },
  Healthcare: {
    roles: [
      "Clinical Lead",
      "Chief Medical Officer",
      "Nurse Practitioner",
      "Health Informatics Manager",
      "Care Operations Director",
      "Physician Advisor",
      "Product Manager",
    ],
    focus: [
      "remote patient monitoring",
      "care coordination",
      "clinical workflows",
      "value-based care",
      "mental health access",
      "health records",
    ],
    nouns: ["Health", "Care", "Clinic", "Medical", "Wellness"],
  },
  Gaming: {
    roles: [
      "Game Designer",
      "Technical Artist",
      "Studio Head",
      "Live Ops Manager",
      "Narrative Director",
      "Gameplay Engineer",
      "Community Lead",
    ],
    focus: [
      "live-service design",
      "multiplayer netcode",
      "procedural worlds",
      "player retention",
      "accessibility in games",
      "mobile monetisation",
    ],
    nouns: ["Games", "Interactive", "Play", "Entertainment", "Studios"],
  },
  Logistics: {
    roles: [
      "Network Planner",
      "Fleet Operations Manager",
      "Supply Chain Director",
      "Customs Specialist",
      "Head of Last Mile",
      "Procurement Lead",
      "Warehouse Operations Lead",
    ],
    focus: [
      "last-mile delivery",
      "cold chain",
      "freight forwarding",
      "route optimisation",
      "port operations",
      "returns",
    ],
    nouns: ["Logistics", "Freight", "Cargo", "Transport", "Supply"],
  },
  "Consumer Hardware": {
    roles: [
      "Industrial Designer",
      "Hardware Engineer",
      "Supply Chain Manager",
      "Product Lead",
      "Firmware Engineer",
      "Head of Manufacturing",
      "Design Researcher",
    ],
    focus: [
      "wearables",
      "battery life",
      "contract manufacturing",
      "smart home devices",
      "repairability",
      "packaging",
    ],
    nouns: ["Devices", "Hardware", "Electronics", "Design Co", "Gear"],
  },
  Climate: {
    roles: [
      "Climate Analyst",
      "Project Developer",
      "Head of Carbon Markets",
      "Energy Storage Engineer",
      "Policy Advisor",
      "Sustainability Director",
      "Grid Planner",
    ],
    focus: [
      "carbon removal",
      "grid storage",
      "heat pumps",
      "offshore wind",
      "supply chain emissions",
      "green hydrogen",
    ],
    nouns: ["Energy", "Climate", "Renewables", "Carbon", "Power"],
  },
  Cybersecurity: {
    roles: [
      "Security Engineer",
      "CISO",
      "Threat Researcher",
      "Red Team Lead",
      "Security Architect",
      "Incident Response Manager",
      "Trust and Safety Lead",
    ],
    focus: [
      "zero trust",
      "incident response",
      "cloud security posture",
      "phishing resistance",
      "supply chain attacks",
      "identity",
    ],
    nouns: ["Security", "Cyber", "Shield", "Sentinel", "Defence"],
  },
  Biotech: {
    roles: [
      "Research Scientist",
      "Principal Scientist",
      "Head of Translational Medicine",
      "Bioinformatician",
      "Clinical Operations Lead",
      "Business Development Director",
      "Lab Manager",
    ],
    focus: [
      "protein design",
      "cell therapy",
      "CRISPR delivery",
      "single-cell sequencing",
      "rare disease trials",
      "assay development",
    ],
    nouns: ["Therapeutics", "Bio", "Biosciences", "Genomics", "Labs"],
  },
  "E-commerce": {
    roles: [
      "Head of Growth",
      "Merchandising Manager",
      "Marketplace Lead",
      "Conversion Specialist",
      "Director of Fulfilment",
      "Founder",
      "Brand Manager",
    ],
    focus: [
      "checkout conversion",
      "marketplace seller tools",
      "subscription retention",
      "returns",
      "cross-border shipping",
      "loyalty",
    ],
    nouns: ["Commerce", "Market", "Shop", "Goods", "Retail"],
  },
  "Venture Capital": {
    roles: [
      "General Partner",
      "Principal",
      "Venture Partner",
      "Investor Relations Lead",
      "Platform Director",
      "Associate",
      "Scout",
    ],
    focus: [
      "pre-seed software",
      "climate funds",
      "deep tech",
      "founder support",
      "secondaries",
      "emerging managers",
    ],
    nouns: ["Ventures", "Capital", "Partners", "Fund", "Investments"],
  },
  Education: {
    roles: [
      "Professor",
      "Head of Curriculum",
      "Learning Designer",
      "School Principal",
      "Program Director",
      "Instructional Coach",
      "Admissions Director",
    ],
    focus: [
      "adult learning",
      "AI in the classroom",
      "STEM outreach",
      "assessment design",
      "teacher training",
      "open courseware",
    ],
    nouns: ["Academy", "Institute", "Learning", "School", "University"],
  },
  "Developer Tools": {
    roles: [
      "Developer Advocate",
      "Staff Engineer",
      "Engineering Manager",
      "Open Source Maintainer",
      "Head of Platform",
      "Solutions Architect",
      "Technical Writer",
    ],
    focus: [
      "build systems",
      "observability",
      "code review tooling",
      "edge runtimes",
      "API design",
      "developer onboarding",
    ],
    nouns: ["Systems", "Tools", "Dev", "Labs", "Cloud"],
  },
  Fintech: {
    roles: [
      "Payments Product Manager",
      "Risk Analyst",
      "Head of Compliance",
      "Backend Engineer",
      "Treasury Lead",
      "Partnerships Director",
      "Fraud Data Scientist",
    ],
    focus: [
      "cross-border payments",
      "open banking",
      "fraud models",
      "embedded finance",
      "SME lending",
      "card issuing",
    ],
    nouns: ["Pay", "Financial", "Bank", "Finance", "Ledger"],
  },
};

/** An industry's words, or the general ones for an industry not listed. */
export function industryFor(name: string | null | undefined): Industry {
  return (name && INDUSTRIES[name]) || GENERAL;
}

/** Two halves of an invented company name. */
export const COMPANY_FIRST = [
  "Halcyon",
  "Northwind",
  "Brightside",
  "Kestrel",
  "Larkspur",
  "Meridian",
  "Orchard",
  "Quillfeather",
  "Redwood",
  "Saltmarsh",
  "Tidewater",
  "Umber",
  "Vantage",
  "Willowbank",
  "Yarrow",
  "Zephyr",
  "Alder",
  "Bramble",
  "Cobalt",
  "Driftwood",
  "Ember",
  "Fernhill",
  "Granite",
  "Harbour",
];

export const SCHOOLS = [
  "University of Washington",
  "Stanford University",
  "MIT",
  "University of Texas at Austin",
  "Northwestern University",
  "Boston University",
  "NYU",
  "University of Toronto",
  "McGill University",
  "Imperial College London",
  "University of Edinburgh",
  "Trinity College Dublin",
  "TU Berlin",
  "ETH Zurich",
  "KTH Royal Institute of Technology",
  "Delft University of Technology",
  "Sorbonne University",
  "University of Lisbon",
  "UNAM",
  "University of São Paulo",
  "University of Nairobi",
  "National University of Singapore",
  "Seoul National University",
  "University of Tokyo",
  "Technion",
  "Indian Institute of Science",
  "University of Sydney",
  "University of Melbourne",
  "University of Copenhagen",
  "Jagiellonian University",
  "Charles University",
  "University of Bologna",
  "Politecnico di Milano",
  "University of Vienna",
  "Lund University",
  "Uppsala University",
];

export const DEGREES = [
  "BSc",
  "BA",
  "BEng",
  "MSc",
  "MA",
  "MBA",
  "MEng",
  "PhD",
  "LLB",
];

export const FIELDS = [
  "Computer Science",
  "Economics",
  "Mechanical Engineering",
  "Design",
  "Political Science",
  "Biology",
  "Mathematics",
  "Physics",
  "Business Administration",
  "Industrial Engineering",
  "Journalism",
  "Environmental Science",
  "Psychology",
  "Architecture",
  "Law",
  "Statistics",
];

/** Things people do outside work. Added to the ones a contact already has. */
export const INTERESTS = [
  "sailing",
  "cycling",
  "chess",
  "gardening",
  "board games",
  "trail running",
  "pottery",
  "photography",
  "ski touring",
  "yoga",
  "rock climbing",
  "bouldering",
  "beekeeping",
  "cooking",
  "guitar",
  "surfing",
  "birding",
  "knitting",
  "fishing",
  "calligraphy",
  "ice hockey",
  "badminton",
  "running",
  "film photography",
  "vinyl records",
  "specialty coffee",
  "natural wine",
  "urban sketching",
  "salsa dancing",
  "kayaking",
  "mountaineering",
  "sourdough",
  "speculative fiction",
  "jazz",
  "tennis",
  "volunteering",
  "woodworking",
  "astronomy",
  "marathons",
  "public speaking",
];

export const SOCIAL_PLATFORMS = [
  { platform: "linkedin", base: "https://www.linkedin.com/in/", chance: 0.85 },
  { platform: "x", base: "https://x.com/", chance: 0.3 },
  { platform: "github", base: "https://github.com/", chance: 0.22 },
  { platform: "instagram", base: "https://www.instagram.com/", chance: 0.15 },
  { platform: "mastodon", base: "https://mastodon.social/@", chance: 0.06 },
] as const;

/** Custom fields a person keeps about somebody, with values to draw from. */
export const ATTRIBUTES: Record<string, string[]> = {
  "Coffee order": [
    "Flat white",
    "Oat cortado",
    "Black, no sugar",
    "Decaf latte",
    "Cold brew",
  ],
  Dietary: [
    "Vegetarian",
    "No shellfish",
    "Vegan",
    "Gluten free",
    "Eats anything",
  ],
  Partner: ["Alex", "Sam", "Jordan", "Priya", "Mateo", "Noor", "Kenji", "Ines"],
  Kids: [
    "Two, both under five",
    "One, at university",
    "Three",
    "Twins",
    "None",
  ],
  "Favourite restaurant": [
    "Anything with a patio",
    "The ramen place by the station",
    "A quiet wine bar",
    "The Sunday market",
  ],
  "Shirt size": ["S", "M", "L", "XL"],
  Languages: [
    "English, German",
    "English, Portuguese",
    "English, Korean",
    "English, French, Spanish",
    "English, Hebrew",
    "English, Swedish",
  ],
  "Met through": [
    "A conference hallway",
    "A mutual friend",
    "A hackathon",
    "An alumni dinner",
    "A newsletter reply",
    "A customer intro",
  ],
  Hometown: [
    "Leeds",
    "Porto",
    "Busan",
    "Denver",
    "Lagos",
    "Kraków",
    "Adelaide",
    "Rosario",
  ],
  "Wine preference": [
    "Riesling",
    "Natural orange",
    "Rioja",
    "Doesn't drink",
    "Champagne",
  ],
};

export const CHANNELS = [
  "email",
  "a short text",
  "a call",
  "Signal",
  "WhatsApp",
  "a calendar invite",
];

export const BEST_TIMES = [
  "before 10am",
  "after lunch",
  "on Tuesdays",
  "late afternoon",
  "early mornings",
  "on Fridays",
  "outside school hours",
];

export const PRONOUNS = ["she/her", "he/him", "they/them"];

/** What an interaction was about. `{focus}` and `{topic}` are filled in. */
export const INTERACTION_TOPICS: Record<
  string,
  { title: string[]; body: string[] }
> = {
  call: {
    title: [
      "Quick catch-up",
      "Intro call",
      "Call about {focus}",
      "Follow-up call",
      "Reference call",
      "Check-in call",
    ],
    body: [
      "Talked through where {focus} stands. Agreed to compare notes again next month.",
      "Short call. They are hiring for {focus} and asked for two names.",
      "Walked through their plan for {focus}. Main worry is timing, not budget.",
      "Left a voicemail first, then connected in the afternoon. Nothing urgent.",
      "They wanted a second opinion on {focus}. Suggested a smaller first step.",
      "Caught them between meetings. Promised to send a summary on {focus} by Friday.",
      "Good call. They are curious how others approach {focus} and asked who to read.",
      "Brief. Their team is stretched on {focus}, so the next step waits until the quarter ends.",
    ],
  },
  meeting: {
    title: [
      "Coffee",
      "Lunch",
      "Office visit",
      "Planning meeting",
      "Panel prep",
      "Breakfast",
      "Walk and talk",
    ],
    body: [
      "Met in person. Spent most of the hour on {focus}. They want an introduction to someone in operations.",
      "Good conversation about {focus}. Promised to send the deck and two articles.",
      "Bumped into each other after the talk and moved to a cafe. Wants to do a joint session on {focus}.",
      "Quiet lunch. They are thinking about a move next year and asked what I would do.",
      "Visited their office. The team showed a demo of their {focus} work and asked for blunt feedback.",
      "Long walk. Mostly personal, then {focus} for the last ten minutes. They are more optimistic than in spring.",
      "Planning session with two of their colleagues. Agreed owners and dates for the {focus} pilot.",
      "Early breakfast before their flight. Talked about {focus} and who else should be in the room.",
    ],
  },
  email: {
    title: [
      "Re: intro",
      "Sent the deck",
      "Thanks for yesterday",
      "Question about {focus}",
      "Checking in",
      "Following up",
    ],
    body: [
      "Sent the summary we talked about, with the two links on {focus}. No reply needed.",
      "They asked a short question about {focus}. Replied the same day.",
      "Forwarded an introduction. Waiting to hear whether the timing works.",
      "Checked in after a quiet spell. They are travelling until the end of the month.",
      "Shared the draft on {focus} and asked for comments by Thursday.",
      "They replied with a long note on {focus}. Worth a proper answer this weekend.",
      "Sent congratulations on the announcement. Short reply back, and an offer to meet in the autumn.",
      "Replied to their thread about {focus}. Copied a colleague who knows the area better.",
    ],
  },
  note: {
    title: [
      "Note",
      "After the event",
      "Something to remember",
      "Idea",
      "Personal",
      "Before we speak",
    ],
    body: [
      "Mentioned {focus} twice. Worth bringing up next time.",
      "New role starting soon. Send congratulations and ask how {focus} is going.",
      "Their birthday is coming up. Likes {topic}, so a book on that would land well.",
      "Prefers an agenda a day ahead. Keep meetings to thirty minutes.",
      "Introduced me to someone working on {focus}. Follow up before the end of the month.",
      "Dislikes long email threads. A short message or a call works better.",
      "Between jobs and open to advice on {focus}. Offer a couple of introductions.",
      "Loves {topic}. Start there before getting to {focus}.",
    ],
  },
  coffee: {
    title: ["Coffee", "Catch up over coffee", "Morning coffee"],
    body: [
      "Coffee near their office. Talked about {focus} and how the year is going.",
      "Short coffee before their next meeting. Mostly about {focus}.",
    ],
  },
};

/** Follow-ups a person writes for themselves. */
export const TASKS = [
  "Send the intro to {focus}",
  "Ask about the {focus} project",
  "Share the article on {focus}",
  "Book lunch",
  "Congratulate on the new role",
  "Follow up on the deck",
  "Introduce to someone in operations",
  "Check in after the conference",
  "Send a birthday note",
  "Return the book",
];

// The search evaluation corpus: 300 contacts and 79 queries, committed as
// JSON. This is the source of that JSON, so a reader can see why each contact
// exists.
//
// Two kinds of contact:
//
// 1. TARGETS. Hand written. Each answers at least one query, and the fields a
//    query leans on are deliberate: a nickname target has the formal name in
//    `name`, and a typo target has a name people misspell.
//
// 2. DISTRACTORS. Generated from the pools below with a fixed seed. Half are
//    near misses that share a target's company, first name or city, because a
//    query that only has to beat noise measures nothing.
//
// About a third have a home or work address in their city's format. The
// streets are real, and the house numbers and postcode ends are not.
//
// Nothing here is a real person. The names are assembled from parts.

export interface EvalContact {
  /** Stable identity across regenerations. The queries name these. */
  key: string;
  name: string;
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  location: string;
  industry: string;
  headline: string;
  about: string;
  tags: string[];
  interests: string[];
  /** Email addresses, on the targets the email queries look up. */
  emails?: string[];
  /** Phone numbers as people write them, on the targets the phone queries dial. */
  phones?: string[];
  /** A home address, a work address or both, on about a third of the contacts. */
  addresses?: EvalAddress[];
}

/** One address as a person writes it, with the label the contact page shows. */
export interface EvalAddress {
  label: "home" | "work";
  address: string;
}

export type QueryKind =
  | "name-typo"
  | "company-role"
  | "location-interest"
  | "nickname"
  | "note-phrase"
  | "nickname-only"
  | "phone"
  | "email"
  | "hyphenated"
  | "prefix"
  | "address"
  | "address-collision";

export interface EvalQuery {
  id: string;
  kind: QueryKind;
  q: string;
  /** Contact keys that count as correct. Order does not matter. */
  expect: string[];
}

// Targets
// Column order: key, name, company, role, location, industry, headline,
// about, tags, interests. First and last name are split from `name`.

type TargetRow = [
  key: string,
  name: string,
  company: string,
  role: string,
  location: string,
  industry: string,
  headline: string,
  about: string,
  tags: string,
  interests: string,
];

const TARGETS: TargetRow[] = [
  // Typo targets. Names with a well known misspelling.
  [
    "jonathan-smith",
    "Jonathan Smith",
    "Northwind Logistics",
    "Operations Director",
    "Manchester",
    "Logistics",
    "Keeps the northern depots running",
    "Runs the night shift rota out of the Trafford Park depot. Wants to talk about pallet tracking before the new year.",
    "operations,logistics",
    "cycling,real ale",
  ],
  [
    "katherine-oconnell",
    "Katherine O'Connell",
    "Halcyon Design Studio",
    "Creative Director",
    "Dublin",
    "Design",
    "Brand systems and type",
    "Redrew the whole identity in six weeks and kept the old wordmark as an easter egg on the invoices.",
    "design,brand",
    "letterpress,sea swimming",
  ],
  [
    "siobhan-murphy",
    "Siobhan Murphy",
    "Kestrel Analytics",
    "Data Scientist",
    "Galway",
    "Analytics",
    "Forecasting and demand models",
    "Built the demand model that replaced the spreadsheet nobody could open. Prefers a phone call to a meeting.",
    "analytics,forecasting",
    "birdwatching,chess",
  ],
  [
    "krzysztof-nowak",
    "Krzysztof Nowak",
    "Baltic Freight Union",
    "Port Liaison",
    "Gdansk",
    "Shipping",
    "Customs and port clearance",
    "Knows every customs officer between Gdansk and Rostock by first name. Answers email at five in the morning.",
    "shipping,customs",
    "sailing,jazz",
  ],
  [
    "aoife-gallagher",
    "Aoife Gallagher",
    "Meridian Health Trust",
    "Clinical Lead",
    "Cork",
    "Healthcare",
    "Outpatient pathway redesign",
    "Cut the outpatient waiting list by a third without hiring anybody. Writes very short emails.",
    "healthcare,clinical",
    "distance running,cookery",
  ],
  [
    "geoffrey-thwaite",
    "Geoffrey Thwaite",
    "Ferrous Works",
    "Plant Manager",
    "Sheffield",
    "Manufacturing",
    "Steel finishing and heat treatment",
    "Third generation at the same works. Will show you the annealing line if you ask nicely.",
    "manufacturing,steel",
    "brass band,allotment",
  ],
  [
    "xiomara-reyes",
    "Xiomara Reyes",
    "Solstice Renewables",
    "Grid Engineer",
    "Seville",
    "Energy",
    "Storage and grid connection",
    "Spends her week arguing with the grid operator about connection queues. Very good at it.",
    "energy,grid",
    "flamenco guitar,rock climbing",
  ],
  [
    "bartholomew-quigley",
    "Bartholomew Quigley",
    "Ravensworth Legal",
    "Partner",
    "Edinburgh",
    "Legal",
    "Commercial contracts",
    "Reads every schedule twice and finds the clause nobody else did. Hates video calls.",
    "legal,contracts",
    "hillwalking,whisky",
  ],
  [
    "anneliese-hofmann",
    "Anneliese Hofmann",
    "Drachen Robotics",
    "Head of Firmware",
    "Stuttgart",
    "Robotics",
    "Motion control firmware",
    "Wrote the motion controller that the whole product line still runs on. Keeps a paper notebook.",
    "robotics,firmware",
    "cross country skiing,piano",
  ],
  [
    "padraig-ocallaghan",
    "Padraig O'Callaghan",
    "Tidewater Marine",
    "Survey Lead",
    "Limerick",
    "Marine",
    "Hydrographic survey",
    "Maps estuary channels for a living. Has strong views about single beam versus multibeam.",
    "marine,survey",
    "kayaking,photography",
  ],

  // Company plus role targets. Several people per company.
  [
    "marcus-delgado",
    "Marcus Delgado",
    "Northwind Logistics",
    "Product Manager",
    "Bristol",
    "Logistics",
    "Owns the tracking product",
    "Took the pallet tracking product from a pilot to eleven depots in a year. Asks for the numbers first.",
    "product,logistics",
    "bouldering,espresso",
  ],
  [
    "priya-raghunathan",
    "Priya Raghunathan",
    "Northwind Logistics",
    "Staff Engineer",
    "Bristol",
    "Logistics",
    "Routing and optimisation",
    "Rewrote the routing solver over one winter and halved the fuel bill. Reviews every pull request properly.",
    "engineering,routing",
    "long distance walking,baking",
  ],
  [
    "tomas-lindqvist",
    "Tomas Lindqvist",
    "Halcyon Design Studio",
    "Product Manager",
    "Stockholm",
    "Design",
    "Runs the client side of the studio",
    "The person clients actually call. Keeps a running list of everything the studio promised.",
    "product,design",
    "sailing,vinyl records",
  ],
  [
    "nadia-benali",
    "Nadia Benali",
    "Kestrel Analytics",
    "Engineering Manager",
    "Lyon",
    "Analytics",
    "Platform and data infrastructure",
    "Runs the platform team. Insists on a runbook before anything ships.",
    "engineering,platform",
    "trail running,ceramics",
  ],
  [
    "declan-mcgrath",
    "Declan McGrath",
    "Meridian Health Trust",
    "Data Analyst",
    "Cork",
    "Healthcare",
    "Waiting list analytics",
    "Produces the waiting list report the board actually reads. Will not round a number to make it look better.",
    "analytics,healthcare",
    "sea kayaking,folk music",
  ],
  [
    "yuki-tanabe",
    "Yuki Tanabe",
    "Drachen Robotics",
    "Product Manager",
    "Stuttgart",
    "Robotics",
    "Owns the industrial arm line",
    "Came from the factory floor into product and it shows in every spec she writes.",
    "product,robotics",
    "aikido,woodworking",
  ],
  [
    "oliver-brandt",
    "Oliver Brandt",
    "Solstice Renewables",
    "Finance Director",
    "Seville",
    "Energy",
    "Project finance for storage",
    "Structures the project finance on every storage site. Fluent in four languages and modest about it.",
    "finance,energy",
    "cycling,opera",
  ],
  [
    "renata-costa",
    "Renata Costa",
    "Solstice Renewables",
    "Grid Engineer",
    "Lisbon",
    "Energy",
    "Substation design",
    "Designs the substations. Turned down a move to head office twice to stay near the sites.",
    "energy,grid",
    "rock climbing,fado",
  ],
  [
    "hassan-farouk",
    "Hassan Farouk",
    "Ravensworth Legal",
    "Data Protection Officer",
    "Edinburgh",
    "Legal",
    "Privacy and data protection",
    "The person every team asks before they collect anything. Answers within the hour, always.",
    "legal,privacy",
    "chess,cricket",
  ],
  [
    "ingrid-solberg",
    "Ingrid Solberg",
    "Baltic Freight Union",
    "Chief Operating Officer",
    "Oslo",
    "Shipping",
    "Runs the freight operation",
    "Took over an operation losing money and turned it round without laying anybody off.",
    "operations,shipping",
    "cross country skiing,sailing",
  ],

  // Location plus interest targets.
  [
    "elena-vasquez",
    "Elena Vasquez",
    "Aurora Bioworks",
    "Research Lead",
    "Lisbon",
    "Biotechnology",
    "Enzyme engineering",
    "Runs the enzyme programme. Climbs every weekend the weather allows and some when it does not.",
    "research,biotech",
    "rock climbing,cold water swimming",
  ],
  [
    "samuel-adeyemi",
    "Samuel Adeyemi",
    "Cobalt Payments",
    "Security Engineer",
    "Berlin",
    "Fintech",
    "Application security",
    "Found the authentication bug that everybody else had walked past. Runs a bouldering group on Thursdays.",
    "security,fintech",
    "bouldering,electronic music",
  ],
  [
    "mireia-puig",
    "Mireia Puig",
    "Cobalt Payments",
    "Customer Success Lead",
    "Barcelona",
    "Fintech",
    "Keeps the large accounts happy",
    "Handles the accounts nobody else wants and keeps every one of them. Cooks for twenty without blinking.",
    "customer success,fintech",
    "cookery,open water swimming",
  ],
  [
    "lukas-meyer",
    "Lukas Meyer",
    "Alpine Instruments",
    "Field Engineer",
    "Innsbruck",
    "Instrumentation",
    "Installs and calibrates in the field",
    "Spends half the year on mountain sites. Ski touring is not a hobby so much as a commute.",
    "instrumentation,field",
    "ski touring,mountaineering",
  ],
  [
    "grace-okonkwo",
    "Grace Okonkwo",
    "Verdant Farms Group",
    "Agronomy Director",
    "Nairobi",
    "Agriculture",
    "Soil and yield programmes",
    "Runs the soil programme across four regions. Keeps bees at home and will tell you about it.",
    "agriculture,agronomy",
    "beekeeping,long distance running",
  ],
  [
    "felix-bergstrom",
    "Felix Bergstrom",
    "Norrland Timber",
    "Sustainability Lead",
    "Umea",
    "Forestry",
    "Certification and carbon accounting",
    "Handles certification across the whole estate. Runs an ultra most years and is quiet about it.",
    "sustainability,forestry",
    "trail running,foraging",
  ],
  [
    "amara-diallo",
    "Amara Diallo",
    "Lumen Publishing",
    "Editorial Director",
    "Paris",
    "Publishing",
    "Non fiction list",
    "Built the non fiction list from nothing. Swims in the Seine basin every morning in summer.",
    "publishing,editorial",
    "open water swimming,cinema",
  ],
  [
    "diego-ferreira",
    "Diego Ferreira",
    "Atlas Surveying",
    "Principal Surveyor",
    "Porto",
    "Construction",
    "Structural survey",
    "Surveys the difficult buildings. Plays in a band that has outlasted three of his jobs.",
    "construction,survey",
    "guitar,rock climbing",
  ],
  [
    "hanna-virtanen",
    "Hanna Virtanen",
    "Boreal Software",
    "Principal Engineer",
    "Helsinki",
    "Software",
    "Distributed systems",
    "Wrote the consensus layer. Swims in the sea in February and considers this normal.",
    "engineering,distributed systems",
    "cold water swimming,knitting",
  ],
  [
    "rafael-moreno",
    "Rafael Moreno",
    "Solstice Renewables",
    "Site Manager",
    "Lisbon",
    "Energy",
    "Builds the sites",
    "Runs construction on the Iberian sites. Climbs with the same partner he has had for fifteen years.",
    "energy,construction",
    "rock climbing,barbecue",
  ],

  // Nickname targets. Formal name stored, nickname used in the query.
  [
    "katherine-ashworth",
    "Katherine Ashworth",
    "Pinewood Interiors",
    "Studio Director",
    "Leeds",
    "Interiors",
    "Residential interiors",
    "Runs the studio and the accounts. Everybody calls her Kate and the invoices say Katherine.",
    "interiors,studio",
    "antiques,gardening",
  ],
  [
    "robert-castellanos",
    "Robert Castellanos",
    "Harbourline Shipping",
    "Fleet Manager",
    "Valencia",
    "Shipping",
    "Fleet maintenance",
    "Keeps eleven vessels in service on a budget for eight. Answers to Bob and nothing else.",
    "shipping,fleet",
    "fishing,domino",
  ],
  [
    "margaret-ellington",
    "Margaret Ellington",
    "Crestwood Capital",
    "Investment Director",
    "London",
    "Investment",
    "Growth stage investment",
    "Sits on six boards and reads every pack. Signs herself Peggy in anything that is not a contract.",
    "investment,finance",
    "bridge,horticulture",
  ],
  [
    "william-oyelaran",
    "William Oyelaran",
    "Sable Media Group",
    "Head of Distribution",
    "Lagos",
    "Media",
    "Distribution partnerships",
    "Knows every distributor on the continent. Introduces himself as Bill and signs off as William.",
    "media,distribution",
    "football,highlife",
  ],
  [
    "elizabeth-varga",
    "Elizabeth Varga",
    "Danube Rail Works",
    "Chief Engineer",
    "Budapest",
    "Rail",
    "Signalling and interlocking",
    "The engineer the regulator asks for by name. Called Liz by everybody who has worked with her.",
    "rail,signalling",
    "thermal baths,violin",
  ],
  [
    "theodore-lindgren",
    "Theodore Lindgren",
    "Frostline Cold Chain",
    "Commercial Director",
    "Malmo",
    "Cold Chain",
    "Sells the cold chain",
    "Closed the pharmaceutical contract everybody said was impossible. Ted on the phone, Theodore on paper.",
    "commercial,cold chain",
    "ice hockey,crime fiction",
  ],
  [
    "alexandra-petrova",
    "Alexandra Petrova",
    "Zenith Materials",
    "Head of Research",
    "Riga",
    "Materials",
    "Composite materials",
    "Holds nine patents on the composite line. Sasha to her team and nobody minds.",
    "research,materials",
    "orienteering,mushroom picking",
  ],
  [
    "christopher-nwosu",
    "Christopher Nwosu",
    "Beacon Telecom",
    "Network Architect",
    "Manchester",
    "Telecom",
    "Core network design",
    "Designed the core the whole north runs on. Goes by Chris except on the org chart.",
    "telecom,network",
    "squash,barbecue",
  ],
  [
    "josephine-marchetti",
    "Josephine Marchetti",
    "Olivetta Foods",
    "Supply Chain Director",
    "Bologna",
    "Food",
    "Sourcing and supply",
    "Rebuilt the supplier base after the bad year. Signs everything Jo and means it.",
    "supply chain,food",
    "cycling,wine",
  ],
  [
    "nikolai-abramov",
    "Nikolai Abramov",
    "Polaris Optics",
    "Optical Designer",
    "Tallinn",
    "Optics",
    "Lens and coating design",
    "Designs the lenses the competition copies. Known as Kolya in every lab he has worked in.",
    "optics,design",
    "astronomy,cross country skiing",
  ],

  // Note phrase targets. A distinctive sentence in `about`.
  [
    "imogen-halvorsen",
    "Imogen Halvorsen",
    "Tessellate Architects",
    "Associate Architect",
    "Bergen",
    "Architecture",
    "Housing and public buildings",
    "Met at the timber conference and spent an hour arguing about cross laminated floor plates over bad coffee.",
    "architecture,housing",
    "hiking,drawing",
  ],
  [
    "ravi-krishnan",
    "Ravi Krishnan",
    "Stonebridge Advisory",
    "Managing Consultant",
    "Singapore",
    "Consulting",
    "Operating model design",
    "Introduced by his old colleague at the airport lounge in Changi, of all the places to meet somebody.",
    "consulting,strategy",
    "badminton,street food",
  ],
  [
    "beatrix-lang",
    "Beatrix Lang",
    "Kaleido Games",
    "Art Director",
    "Vienna",
    "Games",
    "Art direction and pipeline",
    "Sent me the sketchbook photograph of the tram stop that became the whole colour palette for the game.",
    "games,art",
    "sketching,coffee",
  ],
  [
    "olusegun-bello",
    "Olusegun Bello",
    "Harmattan Energy",
    "Regulatory Affairs Lead",
    "Abuja",
    "Energy",
    "Licensing and regulation",
    "Explained the entire licensing regime on the back of a napkin in under ten minutes and it was correct.",
    "energy,regulation",
    "chess,afrobeat",
  ],
  [
    "clementine-roux",
    "Clementine Roux",
    "Vigne et Terre",
    "Export Manager",
    "Bordeaux",
    "Wine",
    "Export markets",
    "Told me the story about the lorry full of rose that spent a week stuck at the wrong border crossing.",
    "wine,export",
    "cycling,cooking",
  ],
  [
    "mateusz-wojcik",
    "Mateusz Wojcik",
    "Granite Build",
    "Commercial Manager",
    "Krakow",
    "Construction",
    "Commercial management",
    "Keeps a laminated card of the contract dates in his wallet and produced it in the middle of dinner.",
    "construction,commercial",
    "mountain biking,history",
  ],
  [
    "saoirse-brennan",
    "Saoirse Brennan",
    "Clearwater Environmental",
    "Principal Ecologist",
    "Sligo",
    "Environment",
    "Freshwater ecology",
    "Counted the freshwater pearl mussels by hand for eleven summers and has the photographs to prove it.",
    "environment,ecology",
    "wild swimming,botany",
  ],
  [
    "haruto-ishikawa",
    "Haruto Ishikawa",
    "Shinrin Timber",
    "Export Director",
    "Sapporo",
    "Forestry",
    "Timber export",
    "Walked me through the whole grading standard with two pieces of cedar on the meeting room table.",
    "forestry,export",
    "hot springs,calligraphy",
  ],
  [
    "valentina-rossi",
    "Valentina Rossi",
    "Ponte Infrastructure",
    "Bridge Engineer",
    "Genoa",
    "Infrastructure",
    "Bridge assessment",
    "Described the cable inspection as the most frightening afternoon of her professional life and laughed.",
    "infrastructure,engineering",
    "sailing,espresso",
  ],
  [
    "emeka-onyeka",
    "Emeka Onyeka",
    "Kernel Robotics",
    "Chief Technology Officer",
    "Dublin",
    "Robotics",
    "Autonomy stack",
    "Drew the entire autonomy stack on a whiteboard from memory while the projector refused to work.",
    "robotics,autonomy",
    "running,jollof",
  ],

  // A hyphenated first name and surname.
  // FTS splits both at the hyphen, and people type the name with the
  // hyphens, with spaces, or run together.
  [
    "anne-marie-dubois-laurent",
    "Anne-Marie Dubois-Laurent",
    "Maison Vireo",
    "Head of Partnerships",
    "Lyon",
    "Hospitality",
    "Partner programmes for boutique hotels",
    "Signed forty independent hotels in one winter by turning up at each front desk in person.",
    "partnerships,hospitality",
    "fencing,opera",
  ],
];

// Emails and phone numbers
// On the targets of the email and phone queries, written the way people
// write them: with a country code or without, with spaces, brackets and
// dashes. The phone queries type the digits only.

const CONTACT_POINTS: Record<string, { emails?: string[]; phones?: string[] }> =
  {
    "jonathan-smith": { phones: ["+44 161 496 0321"] },
    "katherine-oconnell": {
      emails: ["katherine@halcyonstudio.ie"],
      phones: ["+353 1 555 0147"],
    },
    "marcus-delgado": { phones: ["+1 (415) 555-0142"] },
    "priya-raghunathan": { phones: ["(415) 555-0123"] },
    "nadia-benali": { emails: ["nadia.benali@kestrelanalytics.com"] },
    "robert-castellanos": { emails: ["rob.castellanos@fleetwise.io"] },
    "margaret-ellington": {
      emails: ["margaret.ellington@crestwoodcapital.com"],
    },
    "anne-marie-dubois-laurent": {
      emails: ["am.duboislaurent@maisonvireo.fr"],
      phones: ["+33 4 72 00 15 15"],
    },
  };

// Addresses
// Addresses are the lightest column of the keyword index, 0.5 against a
// name's 10 (`WEIGHTS` in `search/lexical.ts`). Two things are measured: a
// street, a postcode or a town that only an address names still finds its
// contact, and a word that an address shares with somebody's name, company,
// role, location or note does not outrank them.
//
// Each is written the way its city writes it: the house number first in
// Britain, Ireland and France and after the street elsewhere, the postcode
// where the country puts it, and the town's own name, "Lisboa", "Wien",
// "Sevilla". Three earlier queries hold a word of an address collision:
// "Seville" (q30), "fleet" (q32) and "Changi" (q42). Apart from those, an
// address meets an earlier query only where its contact already has the word
// in another field, such as the city in the location.

/**
 * Hand-written addresses. Eighteen of the fifty-one targets, about the share
 * the generated ones give everybody else, and the five distractors that the
 * address collisions need.
 */
const ADDRESSES: Record<string, EvalAddress[]> = {
  // The answers to the address queries. No other contact has their words.
  "imogen-halvorsen": [
    { label: "home", address: "Strandgaten 18, 5013 Bergen" },
  ],
  "christopher-nwosu": [
    {
      label: "home",
      address: "27 Burton Road, Didsbury, Manchester M20 2LW",
    },
  ],
  // Lives in Espoo, works in Helsinki. `location` says Helsinki.
  "hanna-virtanen": [
    { label: "home", address: "Tapionaukio 4, 02100 Espoo" },
    { label: "work", address: "Fredrikinkatu 61, 00120 Helsinki" },
  ],
  "mateusz-wojcik": [
    { label: "home", address: "ul. Floriańska 15, 31-019 Kraków" },
  ],

  // Distractors whose address carries a word a target carries in a heavier
  // field: a name (10), a company (5), a role (3), a location (2) and a
  // note (1).
  // Diego Ferreira, and a street in his own city.
  "noise-104": [
    { label: "work", address: "Rua de Ferreira Borges 95, 4050-253 Porto" },
  ],
  // Danube Rail Works, and a street in Edinburgh.
  "noise-064": [
    { label: "home", address: "14 Danube Street, Edinburgh EH4 1NN" },
  ],
  // A fleet manager, and a street in London.
  "noise-011": [
    { label: "work", address: "120 Fleet Street, London EC4A 2BE" },
  ],
  // Five people in Seville, and a street in Dublin. Their own addresses
  // say "Sevilla", as Seville writes it.
  "noise-113": [
    { label: "home", address: "9 Seville Place, Dublin 1, D01 F2X5" },
  ],
  // Ravi Krishnan's note about the lounge in Changi, and a street in his
  // own city.
  "near-ravi-krishnan": [
    { label: "home", address: "212 Changi Road, Singapore 419730" },
  ],

  // The other targets with an address, a few from every kind of query.
  "jonathan-smith": [
    {
      label: "work",
      address: "Ashburton Road West, Trafford Park, Manchester M17 1RY",
    },
  ],
  "katherine-oconnell": [
    { label: "home", address: "22 Pembroke Road, Dublin 4, D04 X7N2" },
  ],
  "geoffrey-thwaite": [
    { label: "work", address: "112 Attercliffe Road, Sheffield S4 7WZ" },
  ],
  "marcus-delgado": [
    { label: "home", address: "8 Cotham Hill, Bristol BS6 6LA" },
  ],
  "renata-costa": [
    { label: "home", address: "Rua da Rosa 54, 1200-385 Lisboa" },
  ],
  "oliver-brandt": [
    { label: "home", address: "Calle Betis 12, 41010 Sevilla" },
  ],
  "samuel-adeyemi": [
    { label: "home", address: "Wiener Straße 34, 10999 Berlin" },
    { label: "work", address: "Friedrichstraße 68, 10117 Berlin" },
  ],
  "amara-diallo": [
    { label: "home", address: "27 rue des Martyrs, 75009 Paris" },
    { label: "work", address: "12 rue Jacob, 75006 Paris" },
  ],
  "robert-castellanos": [
    { label: "home", address: "Carrer de Sueca 22, 46006 València" },
  ],
  "margaret-ellington": [
    { label: "home", address: "18 Elgin Crescent, London W11 2JA" },
  ],
  "elizabeth-varga": [
    { label: "home", address: "Bartók Béla út 32, 1111 Budapest" },
  ],
  "ravi-krishnan": [
    { label: "work", address: "8 Marina View, Singapore 018960" },
  ],
  "clementine-roux": [
    { label: "work", address: "45 quai des Chartrons, 33000 Bordeaux" },
  ],
  "anne-marie-dubois-laurent": [
    { label: "work", address: "8 quai Saint-Antoine, 69002 Lyon" },
  ],
};

/**
 * Two streets in each distractor city, for the generated addresses. `{n}` is
 * the house number. Nairobi's streets go unnumbered, as they mostly are.
 */
const STREETS: Record<string, [string, string]> = {
  Aarhus: [
    "Søndergade {n}, 8000 Aarhus C",
    "Jægergårdsgade {n}, 8000 Aarhus C",
  ],
  Antwerp: ["Meir {n}, 2000 Antwerpen", "Nationalestraat {n}, 2000 Antwerpen"],
  Athens: ["Ermou {n}, 105 63 Athina", "Patission {n}, 104 34 Athina"],
  Barcelona: [
    "Carrer de Mallorca {n}, 08008 Barcelona",
    "Carrer de Verdi {n}, 08012 Barcelona",
  ],
  Basel: ["Freie Strasse {n}, 4001 Basel", "Steinenvorstadt {n}, 4051 Basel"],
  Belfast: [
    "{n} Botanic Avenue, Belfast BT7 1JL",
    "{n} Lisburn Road, Belfast BT9 6AA",
  ],
  Bergen: [
    "Torgallmenningen {n}, 5014 Bergen",
    "Nygårdsgaten {n}, 5015 Bergen",
  ],
  Berlin: [
    "Oranienstraße {n}, 10999 Berlin",
    "Kastanienallee {n}, 10435 Berlin",
  ],
  Bilbao: [
    "Calle Ercilla {n}, 48009 Bilbao",
    "Calle Ledesma {n}, 48001 Bilbao",
  ],
  Bologna: [
    "Via Santo Stefano {n}, 40125 Bologna",
    "Strada Maggiore {n}, 40125 Bologna",
  ],
  Bordeaux: [
    "{n} rue Sainte-Catherine, 33000 Bordeaux",
    "{n} cours Victor Hugo, 33000 Bordeaux",
  ],
  Bratislava: [
    "Obchodná {n}, 811 06 Bratislava",
    "Panská {n}, 811 01 Bratislava",
  ],
  Bristol: [
    "{n} Gloucester Road, Bristol BS7 8AE",
    "{n} Park Street, Bristol BS1 5JA",
  ],
  Budapest: [
    "Andrássy út {n}, 1061 Budapest",
    "Király utca {n}, 1075 Budapest",
  ],
  Cardiff: [
    "{n} Queen Street, Cardiff CF10 2BU",
    "{n} Cathedral Road, Cardiff CF11 9LJ",
  ],
  Cork: [
    "{n} Oliver Plunkett Street, Cork T12 X2C4",
    "{n} MacCurtain Street, Cork T23 W9F1",
  ],
  Dublin: [
    "{n} Camden Street, Dublin 2, D02 HX65",
    "{n} Baggot Street, Dublin 4, D04 V6P3",
  ],
  Edinburgh: [
    "{n} Leith Walk, Edinburgh EH6 5BX",
    "{n} George Street, Edinburgh EH2 2PF",
  ],
  Galway: [
    "{n} Shop Street, Galway H91 E9P4",
    "{n} Dominick Street, Galway H91 T2W7",
  ],
  Genoa: [
    "Via Garibaldi {n}, 16124 Genova",
    "Via XX Settembre {n}, 16121 Genova",
  ],
  Ghent: ["Veldstraat {n}, 9000 Gent", "Korenmarkt {n}, 9000 Gent"],
  Glasgow: [
    "{n} Sauchiehall Street, Glasgow G2 3JD",
    "{n} Great Western Road, Glasgow G12 8HN",
  ],
  Gothenburg: [
    "Kungsportsavenyen {n}, 411 36 Göteborg",
    "Linnégatan {n}, 413 04 Göteborg",
  ],
  Helsinki: [
    "Mannerheimintie {n}, 00100 Helsinki",
    "Fredrikinkatu {n}, 00120 Helsinki",
  ],
  Innsbruck: [
    "Museumstraße {n}, 6020 Innsbruck",
    "Anichstraße {n}, 6020 Innsbruck",
  ],
  Krakow: [
    "ul. Grodzka {n}, 31-006 Kraków",
    "ul. Karmelicka {n}, 31-128 Kraków",
  ],
  Leeds: ["{n} Briggate, Leeds LS1 6HD", "{n} Kirkstall Road, Leeds LS4 2AZ"],
  Lisbon: [
    "Rua Augusta {n}, 1100-053 Lisboa",
    "Avenida da Liberdade {n}, 1250-096 Lisboa",
  ],
  Ljubljana: [
    "Čopova ulica {n}, 1000 Ljubljana",
    "Trubarjeva cesta {n}, 1000 Ljubljana",
  ],
  London: [
    "{n} Upper Street, London N1 2XG",
    "{n} Clerkenwell Road, London EC1M 5RN",
  ],
  Lyon: [
    "{n} rue de la République, 69002 Lyon",
    "{n} rue Mercière, 69002 Lyon",
  ],
  Malmo: [
    "Södra Förstadsgatan {n}, 211 43 Malmö",
    "Davidshallsgatan {n}, 211 45 Malmö",
  ],
  Manchester: [
    "{n} Deansgate, Manchester M3 4LQ",
    "{n} Oldham Street, Manchester M1 1JN",
  ],
  Milan: [
    "Corso Buenos Aires {n}, 20124 Milano",
    "Via Torino {n}, 20123 Milano",
  ],
  Munich: [
    "Leopoldstraße {n}, 80802 München",
    "Sendlinger Straße {n}, 80331 München",
  ],
  Nairobi: ["Ngong Road, Kilimani, Nairobi", "Kimathi Street, Nairobi"],
  Naples: ["Via Toledo {n}, 80134 Napoli", "Via Chiaia {n}, 80132 Napoli"],
  Oslo: ["Bogstadveien {n}, 0355 Oslo", "Thorvald Meyers gate {n}, 0555 Oslo"],
  Paris: ["{n} rue de Rivoli, 75004 Paris", "{n} rue Oberkampf, 75011 Paris"],
  Porto: [
    "Rua de Santa Catarina {n}, 4000-447 Porto",
    "Avenida dos Aliados {n}, 4000-064 Porto",
  ],
  Prague: ["Vodičkova {n}, 110 00 Praha 1", "Karlova {n}, 110 00 Praha 1"],
  // Boulevards, not streets: "iela" begins with the "ie" of q61's address.
  Riga: [
    "Brīvības bulvāris {n}, Rīga, LV-1050",
    "Raiņa bulvāris {n}, Rīga, LV-1050",
  ],
  Rotterdam: [
    "Witte de Withstraat {n}, 3012 BP Rotterdam",
    "Meent {n}, 3011 JH Rotterdam",
  ],
  Seville: [
    "Calle Sierpes {n}, 41004 Sevilla",
    "Calle Feria {n}, 41003 Sevilla",
  ],
  Sheffield: [
    "{n} Division Street, Sheffield S1 4GF",
    "{n} Ecclesall Road, Sheffield S11 8HW",
  ],
  Singapore: [
    "{n} Orchard Road, Singapore 238879",
    "{n} Cecil Street, Singapore 069533",
  ],
  Stockholm: [
    "Drottninggatan {n}, 111 51 Stockholm",
    "Götgatan {n}, 116 46 Stockholm",
  ],
  Stuttgart: [
    "Königstraße {n}, 70173 Stuttgart",
    "Calwer Straße {n}, 70173 Stuttgart",
  ],
  Tallinn: ["Viru {n}, 10140 Tallinn", "Narva mnt {n}, 10117 Tallinn"],
  Turin: ["Via Roma {n}, 10123 Torino", "Via Po {n}, 10124 Torino"],
  Valencia: [
    "Carrer de Colón {n}, 46004 València",
    "Carrer de Russafa {n}, 46004 València",
  ],
  Vienna: ["Mariahilfer Straße {n}, 1060 Wien", "Praterstraße {n}, 1020 Wien"],
  Vilnius: [
    "Gedimino pr. {n}, LT-01103 Vilnius",
    "Pilies g. {n}, LT-01123 Vilnius",
  ],
  Warsaw: [
    "ul. Nowy Świat {n}, 00-373 Warszawa",
    "ul. Marszałkowska {n}, 00-624 Warszawa",
  ],
  Zagreb: ["Ilica {n}, 10000 Zagreb", "Tkalčićeva {n}, 10000 Zagreb"],
  Zurich: ["Bahnhofstrasse {n}, 8001 Zürich", "Langstrasse {n}, 8004 Zürich"],
};

// Queries

const QUERIES: [id: string, kind: QueryKind, q: string, expect: string][] = [
  // Name typos. The letters are wrong; the person is not.
  ["q01", "name-typo", "Jonathon Smyth", "jonathan-smith"],
  ["q02", "name-typo", "Katharine Oconnel", "katherine-oconnell"],
  ["q03", "name-typo", "Shivaun Murphey", "siobhan-murphy"],
  ["q04", "name-typo", "Kristof Novak", "krzysztof-nowak"],
  ["q05", "name-typo", "Eefa Gallacher", "aoife-gallagher"],
  ["q06", "name-typo", "Jeffrey Thwaight", "geoffrey-thwaite"],
  ["q07", "name-typo", "Xiomarra Reyez", "xiomara-reyes"],
  ["q08", "name-typo", "Bartholemew Quigly", "bartholomew-quigley"],
  ["q09", "name-typo", "Annalise Hoffman", "anneliese-hofmann"],
  ["q10", "name-typo", "Porrig O'Callahan", "padraig-ocallaghan"],

  // Company plus role. Both constraints matter: the company has other people
  // in it and the role exists at other companies.
  [
    "q11",
    "company-role",
    "product manager at Northwind Logistics",
    "marcus-delgado",
  ],
  [
    "q12",
    "company-role",
    "staff engineer at Northwind Logistics",
    "priya-raghunathan",
  ],
  [
    "q13",
    "company-role",
    "product manager at Halcyon Design Studio",
    "tomas-lindqvist",
  ],
  [
    "q14",
    "company-role",
    "engineering manager at Kestrel Analytics",
    "nadia-benali",
  ],
  [
    "q15",
    "company-role",
    "data analyst at Meridian Health Trust",
    "declan-mcgrath",
  ],
  ["q16", "company-role", "product manager at Drachen Robotics", "yuki-tanabe"],
  [
    "q17",
    "company-role",
    "finance director at Solstice Renewables",
    "oliver-brandt",
  ],
  [
    "q18",
    "company-role",
    "data protection officer at Ravensworth Legal",
    "hassan-farouk",
  ],
  [
    "q19",
    "company-role",
    "chief operating officer at Baltic Freight Union",
    "ingrid-solberg",
  ],
  [
    "q20",
    "company-role",
    "clinical lead at Meridian Health Trust",
    "aoife-gallagher",
  ],

  // Location plus interest. Neither half alone is enough.
  [
    "q21",
    "location-interest",
    "who in Lisbon goes rock climbing",
    "elena-vasquez,rafael-moreno,renata-costa",
  ],
  ["q22", "location-interest", "bouldering in Berlin", "samuel-adeyemi"],
  ["q23", "location-interest", "someone in Barcelona who cooks", "mireia-puig"],
  ["q24", "location-interest", "ski touring near Innsbruck", "lukas-meyer"],
  ["q25", "location-interest", "beekeeping in Nairobi", "grace-okonkwo"],
  ["q26", "location-interest", "trail running in Umea", "felix-bergstrom"],
  ["q27", "location-interest", "open water swimming in Paris", "amara-diallo"],
  ["q28", "location-interest", "guitar player in Porto", "diego-ferreira"],
  [
    "q29",
    "location-interest",
    "cold water swimming in Helsinki",
    "hanna-virtanen",
  ],
  ["q30", "location-interest", "climbing partner in Seville", "xiomara-reyes"],

  // Nicknames. The stored name is formal.
  ["q31", "nickname", "Kate at the interiors studio", "katherine-ashworth"],
  [
    "q32",
    "nickname",
    "Bob Castellanos the fleet manager",
    "robert-castellanos",
  ],
  ["q33", "nickname", "Peggy at Crestwood Capital", "margaret-ellington"],
  [
    "q34",
    "nickname",
    "Bill in Lagos who does distribution",
    "william-oyelaran",
  ],
  ["q35", "nickname", "Liz the rail signalling engineer", "elizabeth-varga"],
  ["q36", "nickname", "Ted at Frostline Cold Chain", "theodore-lindgren"],
  [
    "q37",
    "nickname",
    "Sasha who leads materials research",
    "alexandra-petrova",
  ],
  ["q38", "nickname", "Chris the network architect", "christopher-nwosu"],
  [
    "q39",
    "nickname",
    "Jo who runs supply chain in Bologna",
    "josephine-marchetti",
  ],
  ["q40", "nickname", "Kolya the optical designer", "nikolai-abramov"],

  // A phrase from a note. The words are in `about` and nowhere else.
  [
    "q41",
    "note-phrase",
    "cross laminated floor plates over bad coffee",
    "imogen-halvorsen",
  ],
  ["q42", "note-phrase", "airport lounge in Changi", "ravi-krishnan"],
  [
    "q43",
    "note-phrase",
    "sketchbook photograph of the tram stop",
    "beatrix-lang",
  ],
  ["q44", "note-phrase", "licensing regime on a napkin", "olusegun-bello"],
  [
    "q45",
    "note-phrase",
    "lorry full of rose stuck at the border",
    "clementine-roux",
  ],
  [
    "q46",
    "note-phrase",
    "laminated card of the contract dates",
    "mateusz-wojcik",
  ],
  [
    "q47",
    "note-phrase",
    "freshwater pearl mussels counted by hand",
    "saoirse-brennan",
  ],
  [
    "q48",
    "note-phrase",
    "two pieces of cedar on the meeting room table",
    "haruto-ishikawa",
  ],
  [
    "q49",
    "note-phrase",
    "most frightening afternoon of her professional life",
    "valentina-rossi",
  ],
  [
    "q50",
    "note-phrase",
    "drew the autonomy stack on a whiteboard from memory",
    "emeka-onyeka",
  ],

  // A nickname and a surname, nothing else. "Peggy" never appears in
  // Margaret's record.
  ["q51", "nickname-only", "Peggy Ellington", "margaret-ellington"],
  ["q52", "nickname-only", "Bob Castellanos", "robert-castellanos"],
  ["q53", "nickname-only", "Ted Lindgren", "theodore-lindgren"],
  ["q54", "nickname-only", "Sasha Petrova", "alexandra-petrova"],

  // Phone numbers typed as digits: without the country code the number was
  // stored with, with a trunk zero, as a local number, and with a country
  // code the number was stored without.
  ["q55", "phone", "4155550142", "marcus-delgado"],
  ["q56", "phone", "01614960321", "jonathan-smith"],
  ["q57", "phone", "5550147", "katherine-oconnell"],
  ["q58", "phone", "14155550123", "priya-raghunathan"],

  // A whole email address.
  [
    "q59",
    "email",
    "margaret.ellington@crestwoodcapital.com",
    "margaret-ellington",
  ],
  ["q60", "email", "rob.castellanos@fleetwise.io", "robert-castellanos"],
  ["q61", "email", "katherine@halcyonstudio.ie", "katherine-oconnell"],
  ["q62", "email", "nadia.benali@kestrelanalytics.com", "nadia-benali"],

  // A hyphenated name, typed four ways.
  [
    "q63",
    "hyphenated",
    "Anne-Marie Dubois-Laurent",
    "anne-marie-dubois-laurent",
  ],
  ["q64", "hyphenated", "Dubois-Laurent", "anne-marie-dubois-laurent"],
  [
    "q65",
    "hyphenated",
    "Anne Marie Dubois Laurent",
    "anne-marie-dubois-laurent",
  ],
  ["q66", "hyphenated", "Annemarie Dubois", "anne-marie-dubois-laurent"],

  // The first letters of a rare name, as somebody types them.
  ["q67", "prefix", "Xiom", "xiomara-reyes"],
  ["q68", "prefix", "Thwa", "geoffrey-thwaite"],
  ["q69", "prefix", "Krzy", "krzysztof-nowak"],
  ["q70", "prefix", "Siob", "siobhan-murphy"],

  // An address, and nothing else. A street, a postcode and a town that only
  // one contact's address names: without the address column, keyword search
  // found nobody for these three.
  ["q71", "address", "Strandgaten", "imogen-halvorsen"],
  ["q72", "address", "M20 2LW", "christopher-nwosu"],
  ["q73", "address", "Espoo", "hanna-virtanen"],
  // An address pasted with its country and without its accents. Nobody's
  // record says "Poland", so no contact holds every word, and six contacts
  // in Krakow hold one. BM25 decides, and the street and the house number
  // put Mateusz first in the keyword list. This is the query that sees an
  // address weight of 0: a column at 0 still matches, but adds nothing. The
  // fused list puts him second, behind a contact whose headline says
  // "Krakow" too, because the vectors read the city and not the address.
  ["q74", "address", "Florianska 15, Krakow, Poland", "mateusz-wojcik"],

  // A word that one contact's address shares with another contact's name,
  // company, role, location or note. The address weighs least, so the other
  // field ranks first: the person named Ferreira before the office on Rua de
  // Ferreira Borges, the five people in Seville before the house on Seville
  // Place. Each fails once the address weight passes its field's: Changi
  // (a note, 1) first, then Seville (a location, 2), Danube (a company, 5),
  // Fleet (a role, a headline, a tag and an email domain) and Ferreira (a
  // name, 10).
  ["q75", "address-collision", "Ferreira", "diego-ferreira"],
  ["q76", "address-collision", "Danube", "elizabeth-varga"],
  ["q77", "address-collision", "Fleet", "robert-castellanos"],
  [
    "q78",
    "address-collision",
    "Seville",
    "xiomara-reyes,oliver-brandt,near-imogen-halvorsen,noise-087,noise-116",
  ],
  ["q79", "address-collision", "Changi", "ravi-krishnan"],
];

// Distractors

/** Deterministic 32-bit PRNG. The corpus must be byte identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Adam",
  "Adele",
  "Ana",
  "Anders",
  "Anita",
  "Arjun",
  "Astrid",
  "Bruno",
  "Camille",
  "Carlos",
  "Cecilia",
  "Daniel",
  "Dorota",
  "Edward",
  "Elif",
  "Emil",
  "Erik",
  "Esther",
  "Fatima",
  "Fiona",
  "Franz",
  "Gabriel",
  "Gemma",
  "Hana",
  "Henrik",
  "Ida",
  "Igor",
  "Irene",
  "Jakob",
  "Jana",
  "Joao",
  "Julia",
  "Kamil",
  "Karin",
  "Kemal",
  "Laura",
  "Leon",
  "Linnea",
  "Lucia",
  "Magnus",
  "Malik",
  "Marta",
  "Matteo",
  "Miriam",
  "Nils",
  "Nora",
  "Omar",
  "Paulo",
  "Petra",
  "Rasmus",
  "Rita",
  "Rosa",
  "Sara",
  "Sergio",
  "Simone",
  "Sofia",
  "Stefan",
  "Tomasz",
  "Ulrika",
  "Vera",
  "Viktor",
  "Yara",
  "Zoltan",
];

const LAST_NAMES = [
  "Andersen",
  "Baptista",
  "Bauer",
  "Bianchi",
  "Carvalho",
  "Dahl",
  "Dubois",
  "Eriksson",
  "Fabbri",
  "Fischer",
  "Garcia",
  "Haas",
  "Hansen",
  "Horvath",
  "Jansen",
  "Jensen",
  "Kaminski",
  "Keller",
  "Kowalski",
  "Laine",
  "Lehmann",
  "Lopes",
  "Marino",
  "Martins",
  "Mensah",
  "Mikkelsen",
  "Moreau",
  "Muller",
  "Nielsen",
  "Novotny",
  "Okafor",
  "Olsen",
  "Pereira",
  "Petit",
  "Ricci",
  "Romano",
  "Sandberg",
  "Santos",
  "Schmidt",
  "Silva",
  "Sorensen",
  "Tamm",
  "Vandenberg",
  "Vargas",
  "Vlasov",
  "Weber",
  "Zielinski",
];

const COMPANIES = [
  "Arcadia Systems",
  "Brightpath Consulting",
  "Cindersoft",
  "Delphi Freight",
  "Everstone Partners",
  "Fairhaven Trust",
  "Glenmore Foods",
  "Hollowell Media",
  "Ironbark Supply",
  "Juniper Labs",
  "Kirkwall Marine",
  "Lanterna Studios",
  "Marlowe Textiles",
  "Nightingale Care",
  "Oakhurst Rail",
  "Pellworm Energy",
  "Quarryfield Build",
  "Redcastle Optics",
  "Silverbeck Legal",
  "Thornbury Wines",
  "Umberslade Farms",
  "Veritas Metrics",
  "Westport Cold Store",
  "Yardley Payments",
];

const ROLES = [
  "Account Manager",
  "Business Analyst",
  "Chief Executive",
  "Commercial Lead",
  "Customer Success Lead",
  "Data Analyst",
  "Data Scientist",
  "Design Lead",
  "Engineering Manager",
  "Field Engineer",
  "Finance Director",
  "Head of People",
  "Marketing Lead",
  "Operations Director",
  "Partnerships Lead",
  "Plant Manager",
  "Principal Engineer",
  "Product Manager",
  "Programme Director",
  "Quality Lead",
  "Research Lead",
  "Sales Director",
  "Security Engineer",
  "Site Manager",
  "Staff Engineer",
  "Studio Director",
  "Supply Chain Director",
  "Technical Writer",
];

const CITIES = [
  "Aarhus",
  "Antwerp",
  "Athens",
  "Barcelona",
  "Basel",
  "Belfast",
  "Bergen",
  "Berlin",
  "Bilbao",
  "Bologna",
  "Bordeaux",
  "Bratislava",
  "Bristol",
  "Budapest",
  "Cardiff",
  "Cork",
  "Dublin",
  "Edinburgh",
  "Genoa",
  "Ghent",
  "Glasgow",
  "Gothenburg",
  "Helsinki",
  "Innsbruck",
  "Krakow",
  "Leeds",
  "Lisbon",
  "Ljubljana",
  "London",
  "Lyon",
  "Malmo",
  "Manchester",
  "Milan",
  "Munich",
  "Nairobi",
  "Naples",
  "Oslo",
  "Paris",
  "Porto",
  "Prague",
  "Riga",
  "Rotterdam",
  "Seville",
  "Sheffield",
  "Stockholm",
  "Stuttgart",
  "Tallinn",
  "Turin",
  "Valencia",
  "Vienna",
  "Vilnius",
  "Warsaw",
  "Zagreb",
  "Zurich",
];

const INDUSTRIES = [
  "Agriculture",
  "Analytics",
  "Architecture",
  "Construction",
  "Consulting",
  "Design",
  "Energy",
  "Environment",
  "Fintech",
  "Food",
  "Forestry",
  "Games",
  "Healthcare",
  "Infrastructure",
  "Instrumentation",
  "Investment",
  "Legal",
  "Logistics",
  "Manufacturing",
  "Marine",
  "Materials",
  "Media",
  "Optics",
  "Publishing",
  "Rail",
  "Robotics",
  "Shipping",
  "Software",
  "Telecom",
  "Wine",
];

const INTERESTS = [
  "archery",
  "badminton",
  "baking",
  "birdwatching",
  "board games",
  "botany",
  "bouldering",
  "bridge",
  "calligraphy",
  "chess",
  "cinema",
  "cookery",
  "crochet",
  "cycling",
  "darts",
  "fishing",
  "gardening",
  "golf",
  "hiking",
  "ice hockey",
  "jazz",
  "kayaking",
  "knitting",
  "model railways",
  "opera",
  "orienteering",
  "painting",
  "photography",
  "piano",
  "pottery",
  "running",
  "sailing",
  "scuba diving",
  "squash",
  "surfing",
  "tennis",
  "violin",
  "woodworking",
  "yoga",
];

const HEADLINE_SHAPES = [
  "Works across {industry}",
  "{role} with a long run at one company",
  "Covers the {city} region",
  "Joined from a larger competitor",
  "Second career, first love",
];

const ABOUT_SHAPES = [
  "Introduced at the {industry} event in {city}. Worth a follow up next quarter.",
  "Came recommended by a mutual contact. Straightforward to deal with.",
  "Moved to {company} last year and is still finding the shape of the role.",
  "Talks fast and answers email slowly. Best reached by phone.",
  "Has been in {industry} long enough to have seen this cycle twice already.",
  "Keen on {interest} and will find a way to mention it.",
];

function pick<T>(rand: () => number, xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? key);
}

/**
 * Contacts whose NAME carries a word another contact carries in its COMPANY.
 *
 * Without these the BM25 column weights barely matter, because every target
 * is close to unique on its own tokens. A Product Manager called "Ida
 * Northwind" competes with the Product Manager at Northwind Logistics: one
 * matches in `name` (weight 10), the other in `company` (weight 5), and only
 * the weights in `search/lexical.ts` decide which wins.
 */
function buildCollisions(targets: EvalContact[]): EvalContact[] {
  const rand = mulberry32(0xc0111d3);
  // Entries 10 to 19 are the company-plus-role block, the ten queries that
  // name an employer and a job title.
  return targets.slice(10, 20).map((target) => {
    const words = target.company.split(" ");
    const firstName = pick(rand, FIRST_NAMES);
    const lastName = words[0];
    const location = pick(rand, CITIES);
    const industry = pick(rand, INDUSTRIES);
    return {
      key: `collide-${target.key}`,
      // The first word of the employer, as a surname.
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      // The rest of the employer, as an employer. Between the name and the
      // company this contact carries every word of the query the target
      // does, only in different columns, which is what leaves the column
      // weights to decide the order.
      company: `${words.slice(1).join(" ") || "Consolidated"} Partners`,
      role: target.role,
      location,
      industry,
      headline: `${target.role} working in ${industry}`,
      about: `No relation to the firm of the same name, which comes up every single time.`,
      tags: [industry.toLowerCase()],
      interests: [pick(rand, INTERESTS)],
    };
  });
}

/**
 * The distractor half of the corpus.
 *
 * `nearMisses` are generated first and on purpose: each one shares exactly
 * one dimension with a target, so a query that only matches on that dimension
 * cannot score well by accident.
 */
function buildDistractors(
  count: number,
  targets: EvalContact[],
): EvalContact[] {
  const rand = mulberry32(0x5eed_1234);
  const out: EvalContact[] = [];

  // Near misses: one per target, cycling through which field is shared.
  targets.forEach((target, i) => {
    const firstName = pick(rand, FIRST_NAMES);
    const lastName = pick(rand, LAST_NAMES);
    const share = i % 3;
    const company = share === 0 ? target.company : pick(rand, COMPANIES);
    const role = share === 1 ? target.role : pick(rand, ROLES);
    const location = share === 2 ? target.location : pick(rand, CITIES);
    const interest =
      share === 2 ? pick(rand, INTERESTS) : (target.interests[0] ?? "cycling");
    const industry = pick(rand, INDUSTRIES);
    out.push({
      key: `near-${target.key}`,
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      company,
      role,
      location,
      industry,
      headline: fill(pick(rand, HEADLINE_SHAPES), {
        industry,
        role,
        city: location,
      }),
      about: fill(pick(rand, ABOUT_SHAPES), {
        industry,
        city: location,
        company,
        interest,
      }),
      tags: [industry.toLowerCase()],
      interests: [interest, pick(rand, INTERESTS)],
    });
  });

  // Plain noise for the rest.
  let n = 0;
  while (out.length < count) {
    const firstName = pick(rand, FIRST_NAMES);
    const lastName = pick(rand, LAST_NAMES);
    const company = pick(rand, COMPANIES);
    const role = pick(rand, ROLES);
    const location = pick(rand, CITIES);
    const industry = pick(rand, INDUSTRIES);
    const interest = pick(rand, INTERESTS);
    out.push({
      key: `noise-${String(n).padStart(3, "0")}`,
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      company,
      role,
      location,
      industry,
      headline: fill(pick(rand, HEADLINE_SHAPES), {
        industry,
        role,
        city: location,
      }),
      about: fill(pick(rand, ABOUT_SHAPES), {
        industry,
        city: location,
        company,
        interest,
      }),
      tags: [industry.toLowerCase()],
      interests: [interest, pick(rand, INTERESTS)],
    });
    n++;
  }

  return out;
}

/**
 * Give about a third of the distractors an address in their own city: one in
 * four gets one, home or work, and one in ten gets both.
 *
 * A random stream of its own, so the draws above stay the same. Every
 * contact takes the same five draws whether or not it gets an address, so a
 * change to one contact never moves the addresses after it. A contact with a
 * hand-written address keeps it.
 */
function assignAddresses(contacts: EvalContact[]): void {
  const rand = mulberry32(0xadd2e55);
  for (const contact of contacts) {
    const roll = rand();
    const swap = rand();
    const label = rand() < 0.6 ? "home" : "work";
    const numbers = [rand(), rand()].map((r) =>
      String(1 + Math.floor(r * 140)),
    );
    const streets = STREETS[contact.location];
    if (contact.addresses || !streets || roll >= 0.34) continue;
    const [first, second] = swap < 0.5 ? streets : [streets[1], streets[0]];
    contact.addresses =
      roll < 0.1
        ? [
            { label: "home", address: first.replace("{n}", numbers[0]) },
            { label: "work", address: second.replace("{n}", numbers[1]) },
          ]
        : [{ label, address: first.replace("{n}", numbers[0]) }];
  }
}

// Assembly

const CORPUS_SIZE = 300;

export function buildCorpus(): {
  contacts: EvalContact[];
  queries: EvalQuery[];
} {
  const targets: EvalContact[] = TARGETS.map(
    ([
      key,
      name,
      company,
      role,
      location,
      industry,
      headline,
      about,
      tags,
      interests,
    ]) => {
      const parts = name.split(" ");
      return {
        key,
        name,
        firstName: parts[0],
        lastName: parts[parts.length - 1],
        company,
        role,
        location,
        industry,
        headline,
        about,
        tags: tags.split(","),
        interests: interests.split(","),
        ...CONTACT_POINTS[key],
        addresses: ADDRESSES[key],
      };
    },
  );

  const collisions = buildCollisions(targets);
  const others = [
    ...collisions,
    ...buildDistractors(
      CORPUS_SIZE - targets.length - collisions.length,
      targets,
    ),
  ];
  for (const contact of others) {
    if (ADDRESSES[contact.key]) contact.addresses = ADDRESSES[contact.key];
  }
  assignAddresses(others);
  const contacts = [...targets, ...others];

  const queries: EvalQuery[] = QUERIES.map(([id, kind, q, expect]) => ({
    id,
    kind,
    q,
    expect: expect.split(","),
  }));

  // A query naming a contact that is not in the corpus would score zero for
  // ever and read as a ranking problem. Fail here instead. So would an
  // address written for a contact that is not there: it never reaches the
  // index.
  const keys = new Set(contacts.map((c) => c.key));
  for (const query of queries) {
    for (const key of query.expect) {
      if (!keys.has(key)) {
        throw new Error(`Query ${query.id} expects unknown contact "${key}"`);
      }
    }
  }
  for (const key of Object.keys(ADDRESSES)) {
    if (!keys.has(key)) {
      throw new Error(`An address is written for unknown contact "${key}"`);
    }
  }
  if (contacts.length !== CORPUS_SIZE) {
    throw new Error(
      `Corpus is ${contacts.length} contacts, expected ${CORPUS_SIZE}`,
    );
  }

  return { contacts, queries };
}

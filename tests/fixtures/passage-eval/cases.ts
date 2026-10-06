/** Separate from the 70-query ranking corpus. Each fact sits after a long preamble, past a short text limit. */
export const passageCases = [
  {
    id: "clocks",
    field: "about",
    fact: "I restore medieval astronomical clocks.",
    query: "Who repairs old mechanical timepieces?",
  },
  {
    id: "cocoa",
    field: "preferences",
    fact: "I advise growers on cocoa fermentation and chocolate flavor.",
    query: "Who can help improve fermented cacao?",
  },
  {
    id: "prosthetics",
    field: "about",
    fact: "I design affordable prosthetic hands for amputees.",
    query: "Who builds artificial hands for people with limb loss?",
  },
  {
    id: "seeds",
    field: "experience",
    fact: "Established a seed bank for drought-resistant crops.",
    query: "Who has experience preserving drought tolerant crop seeds?",
  },
  {
    id: "geothermal",
    field: "about",
    fact: "I develop control systems for geothermal power plants.",
    query: "Who knows about electricity from underground heat?",
  },
  {
    id: "maps",
    field: "education",
    fact: "Studied tactile maps for people with low vision.",
    query: "Who studied maps that blind people can feel?",
  },
  {
    id: "photons",
    field: "about",
    fact: "I research entangled photons for quantum communication.",
    query: "Who researches quantum entanglement of light particles?",
  },
  {
    id: "manuscripts",
    field: "preferences",
    fact: "I conserve damaged medieval manuscripts and parchment.",
    query: "Who restores old handwritten parchment documents?",
  },
  {
    id: "pfas",
    field: "experience",
    fact: "Removed PFAS contamination from firefighting foam at airports.",
    query: "Who has experience cleaning up forever chemicals?",
  },
  {
    id: "theatre",
    field: "about",
    fact: "I direct theatre productions in sign language for deaf audiences.",
    query: "Who creates accessible drama for deaf people?",
  },
  {
    id: "wildlife",
    field: "about",
    fact: "I deploy camera traps to monitor endangered snow leopards.",
    query: "Who tracks rare mountain cats with remote cameras?",
  },
  {
    id: "avalanche",
    field: "preferences",
    fact: "I teach avalanche rescue and snowpack assessment.",
    query: "Who teaches rescue after dangerous snow slides?",
  },
  {
    id: "vaccines",
    field: "experience",
    fact: "Designed refrigerated supply chains for vaccine delivery.",
    query: "Who has experience keeping vaccines cold during transport?",
  },
  {
    id: "dialysis",
    field: "about",
    fact: "I maintain water purification equipment for kidney dialysis clinics.",
    query: "Who maintains clean water systems for dialysis?",
  },
  {
    id: "whales",
    field: "education",
    fact: "Studied underwater acoustics to classify whale calls.",
    query: "Who studied ocean sounds made by whales?",
  },
  {
    id: "fiber",
    field: "about",
    fact: "I use distributed fiber-optic sensing to detect pipeline leaks.",
    query: "Who detects leaking pipelines using optical fiber?",
  },
  {
    id: "coral",
    field: "preferences",
    fact: "I propagate heat-tolerant corals for reef restoration.",
    query: "Who helps damaged coral reefs recover?",
  },
  {
    id: "braille",
    field: "experience",
    fact: "Developed refreshable braille displays for accessible reading.",
    query: "Who has experience building electronic braille readers?",
  },
  {
    id: "glaciers",
    field: "education",
    fact: "Studied satellite measurements of glacier retreat.",
    query: "Who studied shrinking glaciers from space?",
  },
  {
    id: "batteries",
    field: "about",
    fact: "I recover lithium from discarded electric vehicle batteries.",
    query: "Who recycles lithium from used car batteries?",
  },
] as const;

export const passageNegatives = [
  "Who currently works at FormerCo?",
  "Who studies Martian lava tube ecosystems?",
  "Who can design nuclear submarine propulsion?",
  "Who specializes in surgical treatment of brain tumors?",
] as const;

export const passagePreamble =
  "I coordinate projects, plan meetings, prepare budgets, and support colleagues. ".repeat(
    24,
  );

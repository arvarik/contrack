// =============================================================================
// NLP Engine — Pure-Functional String Similarity & Name Comparison
// =============================================================================
// This module contains zero database or server dependencies. Every function
// is a pure computation over string inputs, making it trivially unit-testable.
// =============================================================================

// =============================================================================
// Levenshtein Distance
// =============================================================================

/** Classic DP Levenshtein distance. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// =============================================================================
// Jaro-Winkler Similarity
// =============================================================================

/**
 * Jaro-Winkler similarity (0→1). Designed specifically for short strings like
 * personal names. Rewards matching prefixes, handles transpositions well.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchWindow = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matching characters
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler bonus: reward common prefixes (up to 4 chars)
  let prefixLen = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefixLen++;
    else break;
  }

  return jaro + prefixLen * 0.1 * (1 - jaro);
}

// =============================================================================
// Nickname Dictionary
// =============================================================================

/**
 * Comprehensive nickname ↔ canonical name dictionary.
 * Maps lowercase nicknames to their canonical forms for bidirectional lookup.
 */
export const NICKNAME_GROUPS: string[][] = [
  ["robert", "bob", "bobby", "rob", "robbie", "berto", "beto"],
  ["william", "bill", "billy", "will", "willy"],
  ["james", "jim", "jimmy", "jamie"],
  ["john", "johnny", "jack", "jackie", "jonathan", "jon", "jonny"],
  ["michael", "mike", "mikey", "mick", "micky"],
  ["richard", "rick", "ricky", "dick", "rich", "ritchie"],
  ["thomas", "tom", "tommy", "thom"],
  ["charles", "charlie", "chuck", "chas", "chaz"],
  ["edward", "ed", "eddie", "ned"],
  ["theodore", "theo", "ted", "teddy"],
  ["joseph", "joe", "joey", "pepe", "chepe"],
  ["daniel", "dan", "danny"],
  ["matthew", "matt", "matty"],
  ["christopher", "chris", "topher"],
  ["anthony", "tony", "ant", "toño"],
  ["andrew", "andy", "drew"],
  ["patrick", "pat", "paddy"],
  ["benjamin", "ben", "benny", "benji"],
  ["nicholas", "nick", "nicky", "nico"],
  ["alexander", "alex", "xander", "zander"],
  ["samuel", "sam", "sammy"],
  ["gregory", "greg", "gregg"],
  ["timothy", "tim", "timmy"],
  ["stephen", "steve", "steven", "stephano"],
  ["phillip", "phil", "philip"],
  ["raymond", "ray", "ramon"],
  ["lawrence", "larry", "lance"],
  ["kenneth", "ken", "kenny"],
  ["gerald", "gerry", "jerry"],
  ["ronald", "ron", "ronnie"],
  ["donald", "don", "donny"],
  ["harold", "harry", "hal"],
  ["eugene", "gene"],
  ["leonard", "leo", "lenny", "leon"],
  ["frederick", "fred", "freddy", "rickey"],
  ["nathaniel", "nate", "nathan"],
  ["zachary", "zach", "zack", "zac", "zak"],
  ["maximilian", "max", "maxwell", "maxim"],
  ["dominic", "dom", "dominick"],
  ["terrence", "terry", "terence"],
  ["jeffrey", "jeff", "geoffrey", "geoff"],
  ["douglas", "doug"],
  ["clifford", "cliff"],
  ["vincent", "vince", "vinny"],
  ["arthur", "art", "artie"],
  ["walter", "walt", "wally"],
  ["peter", "pete"],
  ["elizabeth", "liz", "lizzy", "beth", "betty", "eliza", "bess"],
  ["katherine", "kate", "kathy", "katie", "cathy", "catherine", "kathryn"],
  ["jennifer", "jen", "jenny", "jenn"],
  ["margaret", "maggie", "meg", "peggy", "marge", "margie"],
  ["patricia", "patty", "trish", "trisha", "patsy"],
  ["rebecca", "becca", "becky", "rebekah"],
  ["victoria", "vicky", "tori", "vic"],
  ["alexandra", "alexa", "lexi", "sasha", "alexandria"],
  ["deborah", "deb", "debbie", "debra"],
  ["dorothy", "dot", "dottie", "doro"],
  ["christina", "tina", "chrissy", "kristina", "kristen"],
  ["suzanne", "sue", "suzy", "susan", "susannah"],
  ["stephanie", "steph", "stephie"],
  ["samantha", "sami", "sammi"],
  ["danielle", "dani", "dany"],
  ["amanda", "mandy"],
  ["nicole", "nikki", "cole"],
  ["madeline", "maddie", "maddy"],
  ["olivia", "liv", "livvy"],
  ["gabriella", "gabby", "gabi", "gabrielle"],
  ["francisco", "paco", "pancho", "cisco"],
  ["eduardo", "lalo", "guayo"],
  ["jesus", "chuy", "chucho", "chui"],
  ["ignacio", "nacho", "nacio"],
  ["guadalupe", "lupe", "lupita"],
  ["alejandro", "jandro", "alejo"],
  ["guillermo", "memo", "mermo"],
  ["enrique", "quique", "kike"],
  ["mercedes", "meche"],
  ["rosario", "chayo"],
  ["dolores", "lola", "lolita"],
  ["carlos", "carlitos"],
  ["fernando", "fer", "nando"],
  ["abhishek", "abhi"],
  ["siddharth", "sid", "sidhu", "sidd"],
  ["venkatesh", "venky", "venkat"],
  ["karthik", "karthi", "karthick"],
  ["vikram", "vik"],
  ["aishwarya", "aish", "ash"],
  ["priyanka", "priya"],
  ["arvind", "arv"],
  ["srinivasa", "srinivas", "srini"],
  ["ramakrishnan", "ramki"],
  ["krishnan", "krish", "krishna"],
  ["deepak", "deepu"],
  ["aditya", "adi"],
  ["sandeep", "sandy"],
  ["sanjay", "sanju"],
  ["balasubramanian", "bala"],
  ["subramanian", "subbu"],
  ["narendra", "naren"],
  ["ravindra", "ravi"],
  ["chandrashekar", "chandra", "shekar"],
  ["muralidharan", "murali"],
  ["rajesh", "raj", "raju"],
  ["ramachandran", "ram"],
  ["anjali", "anju"],
  ["meenakshi", "meena"],
  ["kavita", "kavi"],
  ["sunita", "suni"],
  ["sneha", "sne"],
  ["pallavi", "pallu"],
  ["jyothi", "jo"],
  ["shruthi", "shru"]
];

// Build fast bidirectional lookup: name → canonical group index
const _nicknameMap = new Map<string, number>();
for (let gi = 0; gi < NICKNAME_GROUPS.length; gi++) {
  for (const name of NICKNAME_GROUPS[gi]) {
    _nicknameMap.set(name, gi);
  }
}

/** Check if two name tokens are nickname-equivalent (e.g., "bob" ↔ "robert") */
export function areNicknameEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = _nicknameMap.get(a);
  const gb = _nicknameMap.get(b);
  return ga !== undefined && ga === gb;
}

// =============================================================================
// Name Tokenization & Similarity
// =============================================================================

/** Titles and suffixes to strip from name tokens before comparison */
const TITLE_SUFFIXES = new Set([
  "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "prof", "prof.",
  "sir", "jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "md", "esq",
  "cpa", "dds", "dvm",
]);

/**
 * Tokenize and clean a name: lowercase, strip titles/suffixes, remove punctuation.
 * "Dr. Sarah Chen III" → ["sarah", "chen"]
 */
function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'")         // normalize apostrophes
    .replace(/[^\w\s'-]/g, " ")     // strip punctuation except hyphens/apostrophes
    .split(/\s+/)
    .map(t => t.replace(/^[.\-]+|[.\-]+$/g, "")) // strip leading/trailing dots/hyphens
    .filter(t => t.length > 0 && !TITLE_SUFFIXES.has(t) && !TITLE_SUFFIXES.has(t + "."));
}

/**
 * Check if a token is an initial (single letter, optionally followed by a period).
 * Returns the letter, or null if not an initial.
 */
function asInitial(token: string): string | null {
  if (token.length === 1 && /[a-z]/.test(token)) return token;
  if (token.length === 2 && token[1] === "." && /[a-z]/.test(token[0])) return token[0];
  return null;
}

/**
 * Multi-signal token-level name similarity.
 * Compares two names using their best token-pair alignment, considering:
 *   - Jaro-Winkler distance between tokens
 *   - Nickname equivalence (Bob ↔ Robert)
 *   - Initial matching (J. matches James, John, etc.)
 *
 * Returns 0→1 where 1 = perfect match.
 */
function tokenSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  if (tokensA.length === 1 && tokensB.length === 1) {
    return singleTokenScore(tokensA[0], tokensB[0]);
  }

  // Greedy best-pair matching: for each token in the shorter list,
  // find its best match in the longer list.
  const [shorter, longer] = tokensA.length <= tokensB.length
    ? [tokensA, tokensB] : [tokensB, tokensA];

  const used = new Set<number>();
  let totalScore = 0;

  for (const sToken of shorter) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let li = 0; li < longer.length; li++) {
      if (used.has(li)) continue;
      const score = singleTokenScore(sToken, longer[li]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = li;
      }
    }
    if (bestIdx >= 0) used.add(bestIdx);
    totalScore += bestScore;
  }

  // Penalty for unmatched tokens in the longer name (extra middle names, etc.)
  // Mild penalty: 0.05 per unmatched token
  const unmatchedPenalty = (longer.length - shorter.length) * 0.05;
  const rawScore = totalScore / shorter.length;

  return Math.max(0, Math.min(1, rawScore - unmatchedPenalty));
}

/** Score a single pair of name tokens (0→1). */
function singleTokenScore(a: string, b: string): number {
  if (a === b) return 1.0;

  // Nickname match → treat as near-identical
  if (areNicknameEquivalent(a, b)) return 0.95;

  // Initial matching: "j" matches "james" (first letter)
  const initA = asInitial(a);
  const initB = asInitial(b);
  if (initA && b.startsWith(initA)) return 0.85;
  if (initB && a.startsWith(initB)) return 0.85;

  // Jaro-Winkler distance
  return jaroWinkler(a, b);
}

/**
 * Production-grade name similarity — multi-signal comparator.
 *
 * Combines: token-level matching, Jaro-Winkler distance, nickname dictionary,
 * initial expansion, and title/suffix stripping. Returns 0→1.
 *
 * Examples:
 *   nameSimilarity("Robert Johnson", "Bob Johnson")     → ~0.975
 *   nameSimilarity("Dr. Sarah Chen", "Sarah Chen")      → ~0.95
 *   nameSimilarity("J. Smith", "James Smith")            → ~0.85
 *   nameSimilarity("Jonathan Smith", "John Smith")       → ~0.95  (nickname)
 *   nameSimilarity("James Kirk", "Vladimir Petrov")      → ~0.0
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // Quick exact match (case-insensitive)
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;

  // Tokenize with title/suffix stripping
  const tokA = tokenizeName(a);
  const tokB = tokenizeName(b);

  // Token-level similarity (primary signal)
  const tokenScore = tokenSimilarity(tokA, tokB);

  // Full-string Jaro-Winkler (catches cases where tokenization hurts)
  const fullJW = jaroWinkler(la, lb);

  // Return the best signal
  return Math.max(tokenScore, fullJW);
}

// =============================================================================
// Phone Normalization
// =============================================================================

/** Strip all non-digits. Returns the last 10 digits to normalize country-code variants. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

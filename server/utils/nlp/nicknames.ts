// =============================================================================
// Nickname Dictionary & Matcher
// =============================================================================
import { tokenizeName } from "./names.ts";

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
  ["shruthi", "shru"],
];

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

/**
 * Structured nickname match: exact last name + nickname-equivalent first name.
 *
 * "Robert Johnson" vs "Bob Johnson" → true  (Bob ↔ Robert, Johnson = Johnson)
 * "Robert Johnson" vs "Bob Smith"   → false (different last names)
 * "Robert" vs "Bob"                 → true  (single-token names, nickname match)
 */
export function isNicknameMatch(nameA: string, nameB: string): boolean {
  if (!nameA || !nameB) return false;

  const tokensA = tokenizeName(nameA);
  const tokensB = tokenizeName(nameB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  if (tokensA.length === 1 && tokensB.length === 1) {
    return (
      areNicknameEquivalent(tokensA[0], tokensB[0]) && tokensA[0] !== tokensB[0]
    );
  }

  const lastA = tokensA[tokensA.length - 1];
  const lastB = tokensB[tokensB.length - 1];
  if (lastA !== lastB) return false;

  const firstA = tokensA[0];
  const firstB = tokensB[0];

  return areNicknameEquivalent(firstA, firstB) && firstA !== firstB;
}

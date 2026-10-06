// Unit: which look a contact's default avatar draws
// The cost of an error is lopsided, and these tests are written around that.
// A neutral face for a name we could have called is a small miss. A beard on
// a woman, or a bow on a man, is the error people notice. So the unisex and
// family-name-first cases below assert "neutral", and the gendered cases
// assert only names that nine in ten carriers share.

import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  classifyName,
  lookFromPronouns,
} from "../../../../server/utils/smartAvatar.ts";
import {
  foldName,
  lookupGivenName,
} from "../../../../server/utils/nlp/givenNames.ts";

describe("lookFromPronouns", () => {
  it.each([
    ["she/her", "female"],
    ["She/Her/Hers", "female"],
    ["(she/her)", "female"],
    ["she/they", "female"],
    ["he/him", "male"],
    ["He / Him / His", "male"],
    ["he/they", "male"],
    ["they/them", "neutral"],
    ["they/she", "neutral"],
    ["xe/xem", "neutral"],
    ["ze/hir", "neutral"],
    ["any pronouns", "neutral"],
  ])("reads %s as %s", (pronouns, look) => {
    expect(lookFromPronouns(pronouns)).toBe(look);
  });

  it.each([null, undefined, "", "  ", "n/a", "N/A", "none", "unknown", "-"])(
    "treats %j as no pronouns at all",
    (pronouns) => {
      expect(lookFromPronouns(pronouns)).toBeNull();
    },
  );

  it("does not read Object.prototype keys as pronouns", () => {
    // A plain object lookup returned the `constructor` function here.
    expect(lookFromPronouns("constructor")).toBe("neutral");
    expect(lookFromPronouns("toString")).toBe("neutral");
  });
});

describe("classifyName: names the data can call", () => {
  it.each([
    "James Smith",
    "Robert Jones",
    "Mohammed Ali",
    "Rahul Gupta",
    "Arvind Arik",
    "Dmitri Ivanov",
    "Hiroshi Tanaka",
    "Kwame Mensah",
    "Chinedu Okafor",
    "Noël Coward",
  ])("%s is male", (name) => {
    expect(classifyName(name)).toBe("male");
  });

  it.each([
    "Mary Wilson",
    "Karen White",
    "Priya Sharma",
    "Fatima Khan",
    "Olga Petrova",
    "Haruka Ito",
    "Ngozi Okonjo",
    "Mei Lin",
  ])("%s is female", (name) => {
    expect(classifyName(name)).toBe("female");
  });
});

describe("classifyName: names used for both", () => {
  it.each([
    "Jordan Lee",
    "Taylor Kim",
    "Casey Ng",
    "Morgan Fox",
    "Riley Park",
    "Avery Stone",
    "Quinn Hart",
    "Jamie Cole",
    "Kelly Ross",
    "Dana Wu",
    "Robin Hood",
    "Leslie Knope",
    "Finley Quaye",
    // French men, American women
    "Jean Martin",
    "Kim Jones",
    "Sasha Grey",
    "Yuki Sato",
    // Sikh given names are shared, with Singh or Kaur saying the rest
    "Harpreet Singh",
    "Gurpreet Kaur",
    "Wei Zhang",
    "Minh Nguyen",
    "Anh Vo",
  ])("%s is neutral", (name) => {
    expect(classifyName(name)).toBe("neutral");
  });

  it.each([
    // "Li" is a Swedish girl's name, "Kim" an American one, and both are
    // family names written first here.
    "Li Na",
    "Kim Min-jun",
    "Lee Min-ho",
    "Nguyen Van Anh",
  ])("%s is neutral: the first word is a family name", (name) => {
    expect(classifyName(name)).toBe("neutral");
  });
});

describe("classifyName: the shapes a name field arrives in", () => {
  it.each([
    ["Dr. Sarah Chen", "female"],
    ["Prof. Alan Turing", "male"],
    ["Mr. Jordan Lee", "male"],
    ["Mrs. Robin Smith", "female"],
    ["Ms Emily Clarke", "female"],
    ["Mx. Sam Lee", "neutral"],
    ["Dame Judi Dench", "female"],
    ["Sir Ian McKellen", "male"],
    ["Señora Ana López", "female"],
    ["Uncle Bob", "male"],
    ["Aunt May", "female"],
    ["J. Robert Oppenheimer", "male"],
    ["Smith, Jane", "female"],
    ["SMITH, JOHN", "male"],
    ["Jane Doe, PhD", "female"],
    ["Doe, Jane, MD", "female"],
    ['Robert "Bob" Smith', "male"],
    ["Sabrina Hans (Coordinator)", "female"],
    ["Mary-Jane Watson", "female"],
    ["Jean-Pierre Dupont", "male"],
    ["Zoë Kravitz", "female"],
    ["José García", "male"],
    ["María López", "female"],
    ["Søren Kierkegaard", "male"],
    ["john.smith@example.com", "male"],
    ["김민준", "male"],
  ])("%s is %s", (name, look) => {
    expect(classifyName(name)).toBe(look);
  });

  it.each([
    "",
    "   ",
    "🙂",
    "Acme Corp",
    "The Design Team",
    "Dr.",
    "constructor",
    "a".repeat(200),
  ])("%j is neutral", (name) => {
    expect(classifyName(name)).toBe("neutral");
  });
});

describe("the given-name table", () => {
  const text = gunzipSync(
    readFileSync(
      new URL(
        "../../../../server/utils/nlp/givenNames.tsv.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8");
  const lines = text.split("\n").filter(Boolean);

  // One pass and one assertion per rule. An expect() per line, over
  // 161,856 lines, took more than the 5 s test limit on a CI runner.
  it("is sorted and well formed, and the binary search finds every line", () => {
    expect(lines.length).toBeGreaterThan(100_000);
    const malformed: number[] = [];
    const unsorted: number[] = [];
    const missed: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^[^\t\n]+\t[FM]$/.test(lines[i])) malformed.push(i + 1);
      if (i > 0 && !(lines[i - 1] < lines[i])) unsorted.push(i + 1);
      const [name, gender] = lines[i].split("\t");
      const look = gender === "F" ? "female" : "male";
      if (lookupGivenName(name) !== look) missed.push(i + 1);
    }
    expect(malformed.slice(0, 10), "malformed lines").toEqual([]);
    expect(unsorted.slice(0, 10), "lines out of order").toEqual([]);
    expect(missed.slice(0, 10), "lines the lookup does not find").toEqual([]);
  });

  it("stores every name folded", () => {
    const unfolded = lines
      .slice(0, 5_000)
      .map((line) => line.split("\t")[0])
      .filter((name) => foldName(name) !== name);
    expect(unfolded.slice(0, 10)).toEqual([]);
  });

  it("finds the first and the last line", () => {
    const [first, firstGender] = lines[0].split("\t");
    const [last, lastGender] = lines[lines.length - 1].split("\t");
    expect(lookupGivenName(first)).toBe(
      firstGender === "F" ? "female" : "male",
    );
    expect(lookupGivenName(last)).toBe(lastGender === "F" ? "female" : "male");
  });

  it("folds accents and case on the way in", () => {
    expect(foldName("José")).toBe("jose");
    expect(foldName("MARÍA")).toBe("maria");
    expect(foldName("Søren")).toBe("soren");
    expect(foldName("Łukasz")).toBe("lukasz");
    expect(foldName("김민준")).toBe("김민준");
    expect(lookupGivenName("JOSÉ")).toBe("male");
  });
});

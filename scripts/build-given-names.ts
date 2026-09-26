/**
 * build-given-names: the table the default avatar reads a first name from.
 *
 *   npx tsx scripts/build-given-names.ts [path/to/wgnd_2_0_sources.csv]
 *
 * Writes `server/utils/nlp/givenNames.tsv.gz`. With no path, the script
 * downloads the source file (about 140 MB) from Harvard Dataverse.
 *
 * Source: the World Gender Name Dictionary 2.0, WIPO, released under CC0 1.0.
 * Raffo, J. (2021), "WGND 2.0", https://doi.org/10.7910/DVN/MSEGSJ. The
 * sources file has one row per name, country, gender and source, with the
 * number of people counted (`nobs`). National statistics offices supply real
 * birth or population counts. Web lists supply a count of one per entry.
 *
 * The rule, in order:
 *
 *   1. Names fold to one key (see `foldName`), so "José" and "Jose" pool.
 *      Only one-word names are kept, because the avatar reads one word.
 *   2. A country votes when it counts at least 30 people with the name.
 *   3. Pooled over the voting countries, at least 90% must share a gender.
 *   4. Every voting country that holds at least 5% of those people must lean
 *      the same way by at least 75%. This is what keeps Jean (French men,
 *      American women) and Finley (half the US count is girls) neutral, while
 *      Karen stays female despite the Armenian Karens.
 *   5. A name that no country counts 30 times needs at least 3 observations,
 *      95% of them one gender.
 *
 * A name that fails is left out. Absence reads as "neutral" to the avatar, so
 * a mixed name costs a guess, never a wrong one.
 */

import { createReadStream, createWriteStream, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import { foldName } from "../server/utils/nlp/givenNames.ts";

const SOURCE_URL =
  "https://dataverse.harvard.edu/api/access/datafile/4750352?format=original";
const OUTPUT = new URL(
  "../server/utils/nlp/givenNames.tsv.gz",
  import.meta.url,
);

/** A country's count of people with the name before it votes. */
const VOTE_MIN = 30;
/** The pooled share one gender must reach. */
const POOLED_SHARE = 0.9;
/** A voting country this large a part of the pool must agree. */
const LARGE_COUNTRY = 0.05;
/** How far that country must lean the same way. */
const LARGE_COUNTRY_LEAN = 0.75;
/** With no voting country: the minimum pooled count and share. */
const THIN_MIN = 3;
const THIN_SHARE = 0.95;

/** A name worth a line: starts with a letter, then letters, marks, ' or -. */
const NAME_SHAPE = /^\p{L}[\p{L}\p{M}'’-]*$/u;

/** Split one CSV line, honouring double-quoted fields. */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      fields.push(field);
      field = "";
    } else field += c;
  }
  fields.push(field);
  return fields;
}

async function sourcePath(): Promise<string> {
  const given = process.argv[2];
  if (given) return given;
  const dir = await mkdtemp(path.join(tmpdir(), "wgnd-"));
  const file = path.join(dir, "wgnd_2_0_sources.csv");
  console.log(`Downloading ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(file),
  );
  return file;
}

type Counts = Map<string, { f: number; m: number }>;

async function pool(file: string): Promise<Map<string, Counts>> {
  const byName = new Map<string, Counts>();
  const lines = createInterface({ input: createReadStream(file) });
  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const [rawName, country, gender, , nobs] = splitCsv(line);
    if (gender !== "F" && gender !== "M") continue;
    const name = foldName(rawName.trim());
    if (name.length < 2 || !NAME_SHAPE.test(name)) continue;
    const count = Number(nobs);
    if (!(count > 0)) continue;

    let countries = byName.get(name);
    if (!countries) byName.set(name, (countries = new Map()));
    const key = country || "??";
    const tally = countries.get(key) ?? { f: 0, m: 0 };
    if (gender === "F") tally.f += count;
    else tally.m += count;
    countries.set(key, tally);
  }
  return byName;
}

function classify(countries: Counts): "F" | "M" | null {
  let votingF = 0;
  let votingM = 0;
  let allF = 0;
  let allM = 0;
  const voters: { n: number; share: number }[] = [];
  for (const { f, m } of countries.values()) {
    allF += f;
    allM += m;
    if (f + m < VOTE_MIN) continue;
    votingF += f;
    votingM += m;
    voters.push({ n: f + m, share: f / (f + m) });
  }

  const voted = votingF + votingM;
  if (voted > 0) {
    const share = votingF / voted;
    const large = voters.filter((v) => v.n / voted >= LARGE_COUNTRY);
    if (
      share >= POOLED_SHARE &&
      large.every((v) => v.share >= LARGE_COUNTRY_LEAN)
    )
      return "F";
    if (
      share <= 1 - POOLED_SHARE &&
      large.every((v) => v.share <= 1 - LARGE_COUNTRY_LEAN)
    )
      return "M";
    return null;
  }

  const all = allF + allM;
  if (all < THIN_MIN) return null;
  const share = allF / all;
  if (share >= THIN_SHARE) return "F";
  if (share <= 1 - THIN_SHARE) return "M";
  return null;
}

async function main() {
  const file = await sourcePath();
  const byName = await pool(file);

  const lines: string[] = [];
  let female = 0;
  let male = 0;
  for (const [name, countries] of byName) {
    const gender = classify(countries);
    if (!gender) continue;
    if (gender === "F") female++;
    else male++;
    lines.push(`${name}\t${gender}`);
  }
  // Default sort compares UTF-16 code units, the order `lookupGivenName`'s
  // binary search assumes. A tab sorts before every letter, so "ab" comes
  // before "abc" here exactly as it does for the bare names.
  lines.sort();

  const text = `${lines.join("\n")}\n`;
  writeFileSync(OUTPUT, gzipSync(Buffer.from(text, "utf8"), { level: 9 }));
  console.log(
    `${byName.size} names read, ${female} female and ${male} male written, ` +
      `${byName.size - female - male} left out`,
  );
  console.log(`Wrote ${OUTPUT.pathname}`);
}

await main();

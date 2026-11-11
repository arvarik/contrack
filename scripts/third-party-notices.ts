// npm run notices — write public/third-party-notices.txt
// The notices for everything Contrack ships that it did not write: the
// packages the build bundles into dist/, the production packages the Docker
// image installs, the two search models, the fonts and the given-name data.
// Each package comes with its version, its licence and its own licence and
// notice files, word for word. The build copies the file into dist/, so every
// instance serves it at /third-party-notices.txt, and the image holds it.
//
// The bundle's list comes from a real build. Vite builds the app without
// writing it, and each module of each chunk, the map's worker included, names
// the package it came from. Two kinds of code reach dist/ with no module of
// their own, and are added by name: Vite's and Rolldown's runtime helpers,
// and the stylesheets src/index.css imports (Tailwind).
//
// The server's list is every package-lock.json entry that a production
// install keeps on Linux (glibc) x64 and arm64, the two images CI builds. The
// image deletes a few of them that it never loads, and the list keeps them.
// A package built for one platform is read from its Linux x64 copy, so run
// this on Linux x64, as CI and the dev container are.
//
//   node scripts/third-party-notices.ts    rewrite public/third-party-notices.txt
//
// tests/unit/repo/thirdPartyNotices.test.ts fails when the committed file
// differs from what this builds, so run it after a dependency changes.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import * as fontkit from "fontkit";
import type { Plugin } from "vite";
import { PINNED_MODELS } from "../server/services/search/modelFiles.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
export const NOTICES_FILE = path.join(ROOT, "public/third-party-notices.txt");
const TEXTS = path.join(import.meta.dirname, "notices");
const SOURCE = "https://github.com/arvarik/contrack";

/** One package as the file lists it. */
interface Entry {
  name: string;
  version: string;
  licence: string;
  /** Where its files are read from: itself, or its x64 twin. */
  dir: string;
  /** The twin whose files stand in, for a package of another CPU. */
  twin?: string;
}

interface PackageJson {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: Array<string | { type?: string }>;
  author?: string | { name?: string };
  repository?: string | { url?: string };
}

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, "utf8")) as T;

/** The SPDX expression a package.json declares, old forms included. */
function licenceOf(pkg: PackageJson): string {
  const one = (l: string | { type?: string } | undefined) =>
    typeof l === "string" ? l : (l?.type ?? "");
  const declared = pkg.license
    ? one(pkg.license)
    : (pkg.licenses ?? []).map(one).filter(Boolean).join(" OR ");
  if (!declared) throw new Error(`${pkg.name} declares no licence`);
  return declared;
}

/** The package folder a module id sits in, or null for the app's own code. */
function packageDirOf(id: string): string | null {
  const clean = id.replace(/\\/g, "/").replace(/\?.*$/, "");
  const at = clean.lastIndexOf("/node_modules/");
  if (at === -1) return null;
  const parts = clean.slice(at + "/node_modules/".length).split("/");
  const depth = parts[0].startsWith("@") ? 2 : 1;
  return (
    clean.slice(0, at + "/node_modules/".length) +
    parts.slice(0, depth).join("/")
  );
}

/** Runtime helpers a bundler writes into chunks, by the virtual id they use. */
const VIRTUAL_PACKAGES: Record<string, string> = {
  "\0vite/": "vite",
  "\0rolldown/": "rolldown",
};

/** Every package folder whose code the production build puts in dist/. */
async function bundledDirs(): Promise<Set<string>> {
  const { build } = await import("vite");
  const ids = new Set<string>();
  const collect = (): Plugin => ({
    name: "third-party-notices",
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === "chunk") for (const id of item.moduleIds) ids.add(id);
      }
    },
  });
  await build({
    root: ROOT,
    configFile: path.join(ROOT, "vite.config.ts"),
    logLevel: "silent",
    build: { write: false, minify: false, reportCompressedSize: false },
    plugins: [collect()],
    worker: { plugins: () => [collect()] },
  });

  const viteRequire = createRequire(
    path.join(ROOT, "node_modules/vite/package.json"),
  );
  const dirs = new Set<string>();
  for (const id of ids) {
    const dir = packageDirOf(id);
    if (dir) {
      dirs.add(dir);
      continue;
    }
    if (!id.startsWith("\0")) continue;
    const prefix = Object.keys(VIRTUAL_PACKAGES).find((p) => id.startsWith(p));
    if (!prefix) throw new Error(`No package for the virtual module ${id}`);
    const name = VIRTUAL_PACKAGES[prefix];
    dirs.add(
      name === "vite"
        ? path.join(ROOT, "node_modules/vite")
        : path.dirname(viteRequire.resolve(`${name}/package.json`)),
    );
  }
  // The stylesheet's own imports, such as Tailwind's base styles.
  const css = readFileSync(path.join(ROOT, "src/index.css"), "utf8");
  for (const [, specifier] of css.matchAll(
    /@(?:import|plugin)\s+"([^"./][^"]*)"/g,
  )) {
    dirs.add(path.join(ROOT, "node_modules", specifier));
  }
  return dirs;
}

/** The bundled packages, one entry per name and version. */
async function bundledEntries(): Promise<Entry[]> {
  const entries = new Map<string, Entry>();
  for (const dir of await bundledDirs()) {
    const pkg = readJson<PackageJson>(path.join(dir, "package.json"));
    const entry = {
      name: pkg.name,
      version: pkg.version,
      licence: licenceOf(pkg),
      dir,
    };
    entries.set(`${pkg.name}@${pkg.version}`, entry);
  }
  return sortEntries([...entries.values()]);
}

interface LockEntry {
  version: string;
  license?: string;
  dev?: boolean;
  optional?: boolean;
  os?: string[];
  cpu?: string[];
  libc?: string[];
}

/** True when a production install on Linux glibc x64 or arm64 keeps it. */
function inImage(entry: LockEntry): boolean {
  const allows = (list: string[] | undefined, value: string) =>
    !list ||
    list.includes(value) ||
    (list.every((v) => v.startsWith("!")) && !list.includes(`!${value}`));
  return (
    !entry.dev &&
    allows(entry.os, "linux") &&
    (allows(entry.cpu, "x64") || allows(entry.cpu, "arm64")) &&
    allows(entry.libc, "glibc")
  );
}

/** The production packages the Docker image installs. */
function serverEntries(): Entry[] {
  const lock = readJson<{ packages: Record<string, LockEntry> }>(
    path.join(ROOT, "package-lock.json"),
  );
  const entries = new Map<string, Entry>();
  for (const [key, lockEntry] of Object.entries(lock.packages)) {
    if (!key.includes("node_modules/") || !inImage(lockEntry)) continue;
    const dir = path.join(ROOT, key);
    const name = key.slice(
      key.lastIndexOf("node_modules/") + "node_modules/".length,
    );
    let entry: Entry;
    if (existsSync(path.join(dir, "package.json"))) {
      const pkg = readJson<PackageJson>(path.join(dir, "package.json"));
      entry = { name, version: pkg.version, licence: licenceOf(pkg), dir };
    } else {
      // Another CPU's build: the x64 package of the same release has its files.
      const twin = name.replace("arm64", "x64");
      const twinDir = path.join(ROOT, "node_modules", twin);
      if (twin === name || !existsSync(path.join(twinDir, "package.json"))) {
        // An optional package npm skips on Linux, as the image does.
        if (lockEntry.optional) continue;
        throw new Error(
          `${name} is not installed. Run npm run notices on Linux x64.`,
        );
      }
      const licence = lockEntry.license;
      if (!licence) throw new Error(`${name} declares no licence`);
      entry = { name, version: lockEntry.version, licence, dir: twinDir, twin };
    }
    entries.set(`${name}@${entry.version}`, entry);
  }
  return sortEntries([...entries.values()]);
}

function sortEntries(entries: Entry[]): Entry[] {
  return entries.sort((a, b) =>
    a.name === b.name
      ? a.version.localeCompare(b.version)
      : a.name < b.name
        ? -1
        : 1,
  );
}

/** A file's text with LF line ends and no trailing blanks. */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright|third[-_]?party)/i;

/** A package's own licence and notice files, each under its name. */
function licenceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f) && statSync(path.join(dir, f)).isFile())
    .sort()
    .map(
      (f) => `--- ${f} ---\n${clean(readFileSync(path.join(dir, f), "utf8"))}`,
    );
}

/** The licence section of a package's README, for a package with no file. */
function readmeLicence(dir: string): string | null {
  const readme = readdirSync(dir).find((f) => /^readme(\.md)?$/i.test(f));
  if (!readme) return null;
  const lines = clean(readFileSync(path.join(dir, readme), "utf8")).split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s*licen[cs]/i.test(l));
  if (start === -1) return null;
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const heading = /^(#+)\s/.exec(lines[i]);
    if (heading && heading[1].length <= level) {
      end = i;
      break;
    }
  }
  return `--- ${readme}, ${lines[start].replace(/^#+\s*/, "")} ---\n${lines
    .slice(start + 1, end)
    .join("\n")
    .trim()}`;
}

/** The canonical texts at the end, by the SPDX ids a package can declare. */
const CANONICAL: Record<string, string> = {
  MIT: "MIT",
  ISC: "ISC",
  "Apache-2.0": "Apache-2.0",
  Apache: "Apache-2.0",
  "LGPL-3.0": "LGPL-3.0",
  "LGPL-3.0-or-later": "LGPL-3.0",
  "OFL-1.1": "OFL-1.1",
  "BSD-3-Clause": "BSD-3-Clause",
};

/** The canonical texts a licence expression names, in a stable order. */
function canonicalFor(licence: string): string[] {
  const ids = licence.match(/[A-Za-z0-9.+-]+/g) ?? [];
  const found = new Set<string>();
  for (const id of ids) if (CANONICAL[id]) found.add(CANONICAL[id]);
  if (found.has("LGPL-3.0")) found.add("GPL-3.0");
  return [...found].sort();
}

/** Where the canonical texts a package relies on are, as a clause. */
function textsOf(ids: string[]): string {
  if (ids.length === 0) return "";
  if (ids.length === 1)
    return `, and the ${ids[0]} text is under Licence texts`;
  return `, and the ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)} texts are under Licence texts`;
}

/** Who to credit for a package that ships no licence file. */
function creditOf(dir: string): string {
  const pkg = readJson<PackageJson>(path.join(dir, "package.json"));
  const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  const repo =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return [author, repo?.replace(/^git\+/, "").replace(/\.git$/, "")]
    .filter(Boolean)
    .join(", ");
}

/** The search models, with the licence their model cards give. */
const MODEL_LICENCES: Record<string, string> = {
  "Xenova/all-MiniLM-L6-v2":
    "Apache-2.0, as its model card says. An ONNX conversion of sentence-transformers/all-MiniLM-L6-v2, Apache-2.0.",
  "Xenova/ms-marco-TinyBERT-L-2-v2":
    "Apache-2.0, from its source. An ONNX conversion of cross-encoder/ms-marco-TinyBERT-L2-v2, whose model card says Apache-2.0, built on Google's BERT-Tiny (google/bert_uncased_L-2_H-128_A-2), Apache-2.0. The converted copy's own card names no licence.",
};

/** The self-hosted fonts, by family, from the font files themselves. */
function fontLines(): string[] {
  const dir = path.join(ROOT, "public/fonts");
  const families = new Map<string, string[]>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".woff2"))
    .sort()) {
    const family = file.split("-")[0];
    families.set(family, [...(families.get(family) ?? []), file]);
  }
  return [...families].map(([family, files]) => {
    const font = fontkit.openSync(path.join(dir, files[0]));
    if ("fonts" in font) throw new Error(`${files[0]} is a collection`);
    // The name table, which the typings leave out: version and licence URL.
    const records = (
      font as unknown as {
        name: { records: Record<string, { en?: string } | undefined> };
      }
    ).name.records;
    const version = (records.version?.en ?? "").replace(/^Version\s*/, "");
    const name = family[0].toUpperCase() + family.slice(1);
    return [
      `${name} ${version.replace(/;.*$/, "")}: fonts/${family}-*.woff2, ${files.length} files`,
      `  ${font.copyright}`,
      `  OFL-1.1 (${records.licenseURL?.en ?? "SIL Open Font License"}). The text is under Licence texts.`,
    ].join("\n");
  });
}

const RULE = "=".repeat(78);
const heading = (title: string) => `${RULE}\n${title}\n${RULE}`;
const listLine = (e: Entry) => `${e.name} ${e.version}  ${e.licence}`;

/** The whole notices file, as the committed copy holds it. */
export async function buildNotices(): Promise<string> {
  const bundled = await bundledEntries();
  const server = serverEntries();
  for (const model of PINNED_MODELS) {
    if (!MODEL_LICENCES[model.id]) {
      throw new Error(`Add the licence of ${model.id} to MODEL_LICENCES`);
    }
  }
  const names = path.join(ROOT, "server/utils/nlp/givenNames.tsv.gz");
  if (!existsSync(names))
    throw new Error("server/utils/nlp/givenNames.tsv.gz moved");

  const canonical = new Set(["Apache-2.0", "GPL-3.0", "LGPL-3.0", "OFL-1.1"]);
  const seen = new Map<string, string>();
  const texts: string[] = [];
  for (const entry of [...bundled, ...server]) {
    const key = `${entry.name} ${entry.version}`;
    if (seen.has(`entry:${key}`)) continue;
    seen.set(`entry:${key}`, key);
    let body: string;
    if (entry.twin) {
      body = `The same files as ${path.relative(path.join(ROOT, "node_modules"), entry.dir)} ${entry.version}, its build for x64.`;
    } else {
      const files = licenceFiles(entry.dir);
      if (files.length > 0) {
        const text = files.join("\n\n");
        const hash = createHash("sha256").update(text).digest("hex");
        const first = seen.get(`text:${hash}`);
        if (first) {
          body = `The same licence text as ${first}, above.`;
        } else {
          seen.set(`text:${hash}`, key);
          body = text;
        }
      } else {
        const named = canonicalFor(entry.licence);
        for (const id of named) canonical.add(id);
        const credit = creditOf(entry.dir);
        body = [
          `This package ships no licence file. Its package.json declares ${entry.licence}${textsOf(named)}.${credit ? ` Its authors: ${credit}.` : ""}`,
          readmeLicence(entry.dir),
        ]
          .filter(Boolean)
          .join("\n\n");
      }
    }
    texts.push(`${heading(`${key}  (${entry.licence})`)}\n${body}`);
  }

  const sections = [
    `THIRD-PARTY NOTICES FOR CONTRACK

Contrack is free software under the GNU Affero General Public License v3.0
(the LICENSE file). It ships software and data that others wrote, under the
licences below. npm run notices writes this file from the build and from
package-lock.json. Do not edit it by hand.

The GNU LGPL v3 and its source
------------------------------
heic-to, the HEIC reader in the browser app, and libvips with the libraries
it bundles, the image library behind sharp on the server, are under the GNU
Lesser General Public License v3 (heic-to and libvips as "or later"). Each
stays a separate file that can be replaced: heic-to is the chunk
assets/heic-to-<hash>.js, which the app loads only when it reads a HEIC
photo, and libvips is the shared library
node_modules/@img/sharp-libvips-linux-<cpu>/lib/libvips-cpp.so.*, which sharp
loads. Contrack's complete source, including the build that bundles heic-to,
is at ${SOURCE} under the GNU AGPL v3.
The libraries' own source: heic-to at github.com/hoppergee/heic-to (its
version tag), built from libheif and libde265; libvips and its libraries at
github.com/lovell/sharp-libvips (its version tag), whose versions.json names
each library's version. The LGPL v3 and the GNU GPL v3 it builds on are under
Licence texts.

Outside this file: the Docker image's base, Debian and Node.js, keeps its own
notices, Debian's in /usr/share/doc/*/copyright. The map's tiles, styles and
glyphs load at run time from the style's host, OpenFreeMap by default, and are
not part of Contrack.`,
    `${heading("The browser app: packages the build bundles into dist/")}\n${bundled.map(listLine).join("\n")}`,
    `${heading("The server: production packages the Docker image installs")}\n${server
      .map((e) => (e.twin ? `${listLine(e)}  (arm64 image)` : listLine(e)))
      .join("\n")}`,
    `${heading("The search models: models/ in the Docker image")}\n${PINNED_MODELS.map(
      (m) =>
        `${m.id}, revision ${m.revision}: ${m.files.map((f) => f.path).join(", ")}\n  ${MODEL_LICENCES[m.id]}`,
    ).join("\n")}`,
    `${heading("Fonts: /fonts/ in the app")}\n${fontLines().join("\n")}`,
    `${heading("Data")}\nserver/utils/nlp/givenNames.tsv.gz: given names, built from the World Gender Name
  Dictionary 2.0, WIPO. Raffo, J. (2021), "WGND 2.0",
  https://doi.org/10.7910/DVN/MSEGSJ. CC0 1.0: no rights reserved.
The drawn avatars come from the DiceBear packages above, whose licence files
name each style's artist and terms.`,
    `${heading("Package licence and notice files")}\n\n${texts.join("\n\n")}`,
    `${heading("Licence texts")}\n\n${[...canonical]
      .sort()
      .map(
        (id) =>
          `${heading(id)}\n${clean(readFileSync(path.join(TEXTS, `${id}.txt`), "utf8"))}`,
      )
      .join("\n\n")}`,
  ];
  return `${sections.join("\n\n")}\n`;
}

async function main(): Promise<void> {
  const text = await buildNotices();
  await writeFile(NOTICES_FILE, text);
  console.log(
    `Wrote ${path.relative(process.cwd(), NOTICES_FILE)} (${Math.round(text.length / 1024)} KB)`,
  );
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("third-party-notices.ts") ||
    process.argv[1].endsWith("third-party-notices.js"));

if (isDirectRun) {
  void main();
}

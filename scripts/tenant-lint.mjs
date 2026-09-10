#!/usr/bin/env node
// =============================================================================
// tenant-lint — find SQL over owned tables that carries no owner predicate
// =============================================================================
// Multi-tenancy fails quietly. A SELECT that forgets `AND ownerId = ?` returns
// another person's contacts and looks perfectly healthy in every test that
// only ever creates one user. This scanner reads server/**/*.ts, finds every
// statement that touches an owned table, and flags the ones with no owner in
// them.
//
// A statement that legitimately carries no owner predicate is annotated on the
// line above:
//
//   // tenant-lint: allow instance sweep
//   sqlite.prepare("DELETE FROM ai_invocations WHERE createdAt < ?")
//
// Two modes:
//   --report          print a table, exit 0.
//   --strict <glob...>  exit 1 on any flag in a matching file. Several globs
//                     may follow, because Phase 2 converted one domain at a
//                     time and each sub-phase added its files. Sub-phase 2i
//                     replaced the whole list with one glob, and
//                     `npm run lint` now runs
//                     `--strict "server/**/*.ts"` over the whole tree.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

/** Tables with an ownerId column, or that hold owned rows. */
export const OWNED_TABLES = [
  "contacts",
  "lists",
  "interactions",
  "action_items",
  "dedupe_suggestions",
  "dedupe_exclusions",
  "dedupe_merge_log",
  "ai_invocations",
];

/** Virtual tables partitioned by owner. FTS uses a token, not a column. */
export const VIRTUAL_TABLES = [
  "contacts_fts",
  "search_embeddings",
  "contact_embeddings",
];

/** Drizzle schema objects that map to owned tables. */
export const OWNED_SCHEMA_KEYS = [
  "contacts",
  "lists",
  "interactions",
  "actionItems",
  "dedupeSuggestions",
  "dedupeExclusions",
  "dedupeMergeLog",
];

/** The only reasons an allow comment may give. */
export const ALLOWED_REASONS = [
  "instance sweep",
  "owner-checked by caller",
  "boot migration",
  "admin cross-user",
  "derived table",
];

const ALL_TABLES = [...OWNED_TABLES, ...VIRTUAL_TABLES];
const TABLE_RE = new RegExp(
  `\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(${ALL_TABLES.join("|")})\\b`,
  "i",
);
const DRIZZLE_RE = new RegExp(
  `\\b(?:from|insert|update|delete)\\s*\\(\\s*(?:schema\\.)?(${OWNED_SCHEMA_KEYS.join("|")})\\b`,
);

/** Characters that can end an expression, so a following `/` is a division. */
const ENDS_EXPRESSION = /[\w$)\]"'`]/;

/** Words that end an expression despite looking like identifiers. */
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * Pull every string and template literal out of a source file, with the line
 * it starts on. Comments are skipped so a SQL example in a comment is not
 * mistaken for a statement.
 *
 * Regular expressions are skipped too, and that is not cosmetic. A quote
 * inside a regex body — `/[",\n]/` in the CSV escaper, `data-id="..."` in the
 * mention matcher — used to open a string that ran to the next quote anywhere
 * in the file. Every quote after it was then off by one: real statements read
 * as code and were never scanned, so a file could pass `--strict` while
 * holding an unscoped statement further down.
 */
function extractLiterals(source) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  /** The last significant code character, for telling regex from division. */
  let prev = "";
  /** The identifier immediately before `prev`, for the keyword cases. */
  let word = "";

  const remember = (ch) => {
    if (/\s/.test(ch)) return;
    if (/[\w$]/.test(ch)) word += ch;
    else word = "";
    prev = ch;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    // Line comment.
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    // Block comment.
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    // Regular expression literal. A `/` is a division only when what precedes
    // it can end an expression, and `return /re/` is the case where an
    // identifier character still cannot.
    if (
      c === "/" &&
      (!ENDS_EXPRESSION.test(prev) ||
        (/[\w$]/.test(prev) && REGEX_KEYWORDS.has(word)))
    ) {
      const start = i;
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const ch = source[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        // A regex literal cannot span a line. Anything that does was a
        // division after all, so fall through and treat it as one.
        if (ch === "\n") break;
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (closed) {
        while (j < n && /[a-z]/.test(source[j])) j++; // flags
        i = j;
        prev = "/";
        word = "";
        continue;
      }
      i = start; // not a regex; fall through to the operator path below
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      let value = "";
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          value += ch + (source[i + 1] ?? "");
          if (source[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        if (ch === "\n") line++;
        value += ch;
        i++;
      }
      out.push({ value, line: startLine });
      prev = quote;
      word = "";
      continue;
    }
    remember(c);
    i++;
  }
  return out;
}

/** Read the `// tenant-lint: allow <reason>` annotation above a line, if any. */
function allowAbove(lines, lineNumber) {
  for (let i = lineNumber - 2; i >= 0 && i >= lineNumber - 3; i--) {
    const text = (lines[i] ?? "").trim();
    const m = text.match(/^\/\/\s*tenant-lint:\s*allow\s+(.+?)\s*$/);
    if (m) return m[1];
    if (text !== "" && !text.startsWith("//")) break;
  }
  return null;
}

/**
 * Scan one file's source. Returns a finding per statement that touches an
 * owned table without an owner predicate, and per invalid allow comment.
 */
export function scanSource(source, file = "<memory>") {
  const findings = [];
  const lines = source.split("\n");

  const consider = (text, line, kind) => {
    const hasOwner = /ownerId|ownerTok/.test(text);
    const reason = allowAbove(lines, line);

    if (reason !== null && !ALLOWED_REASONS.includes(reason)) {
      findings.push({
        file,
        line,
        kind,
        severity: "unknown-reason",
        reason,
        text: text.trim().slice(0, 120).replace(/\s+/g, " "),
      });
      return;
    }
    if (hasOwner || reason !== null) return;
    findings.push({
      file,
      line,
      kind,
      severity: "unscoped",
      reason: null,
      text: text.trim().slice(0, 120).replace(/\s+/g, " "),
    });
  };

  for (const lit of extractLiterals(source)) {
    const m = lit.value.match(TABLE_RE);
    if (m) consider(lit.value, lit.line, `sql:${m[1].toLowerCase()}`);
  }

  lines.forEach((text, idx) => {
    const m = text.match(DRIZZLE_RE);
    if (!m) return;
    // Look at the whole chained statement, which may span several lines.
    let stmt = text;
    for (let j = idx + 1; j < lines.length && !stmt.includes(";"); j++) {
      stmt += "\n" + lines[j];
    }
    consider(stmt, idx + 1, `drizzle:${m[1]}`);
  });

  return findings;
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

export function scanProject(root = "server") {
  const findings = [];
  for (const file of walk(root)) {
    findings.push(...scanSource(fs.readFileSync(file, "utf8"), file));
  }
  return findings;
}

/** Turn a shell-style glob into a RegExp. Supports ** and *. */
export function globToRegExp(glob) {
  // `**/` crosses path separators and may match none of them, so
  // `server/**/*.ts` covers `server/db.ts` as well as `server/a/b.ts`. That
  // is the whole point of the Phase 2i glob: a file sitting directly in
  // `server/` must not fall outside strict mode. A lone `*` never crosses a
  // separator. One pass over the three forms, longest first, so the
  // replacement text is never rewritten by a later rule.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\*\*|\*/g, (m) =>
      m === "**/" ? "(?:[^/]*\\/)*" : m === "**" ? ".*" : "[^/]*",
    );
  return new RegExp(`^${escaped}$`);
}

function main(argv) {
  const strictIndex = argv.indexOf("--strict");
  const strict = strictIndex !== -1;
  const globs = strict
    ? argv.slice(strictIndex + 1).filter((a) => !a.startsWith("--"))
    : [];
  const findings = scanProject("server");

  const unscoped = findings.filter((f) => f.severity === "unscoped");
  const badReason = findings.filter((f) => f.severity === "unknown-reason");

  if (strict) {
    if (globs.length === 0) {
      console.error(
        "tenant-lint: --strict needs a glob, e.g. --strict 'server/**'",
      );
      process.exit(2);
    }
    const patterns = globs.map(globToRegExp);
    const inScope = findings.filter((f) =>
      patterns.some((re) => re.test(f.file)),
    );
    for (const f of inScope) {
      console.error(`${f.file}:${f.line}  ${f.severity}  ${f.kind}  ${f.text}`);
    }
    if (inScope.length) {
      console.error(
        `\ntenant-lint: ${inScope.length} problem(s) in ${globs.join(", ")}`,
      );
      process.exit(1);
    }
    console.log(
      `tenant-lint: clean for ${globs.length} glob(s): ${globs.join(", ")}`,
    );
    return;
  }

  // Report mode. Never fails the build in Phase 0.
  const byFile = new Map();
  for (const f of findings) {
    byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
  }
  const rows = [...byFile.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  console.log("tenant-lint report (Phase 0 baseline)");
  console.log("");
  console.log(
    `  statements over owned tables with no owner predicate: ${unscoped.length}`,
  );
  console.log(
    `  allow comments with an unknown reason:                ${badReason.length}`,
  );
  console.log(
    `  files affected:                                       ${rows.length}`,
  );
  console.log("");
  console.log("| count | file |");
  console.log("| ----- | ---- |");
  for (const [file, count] of rows) {
    console.log(`| ${String(count).padStart(5)} | ${file} |`);
  }
  if (badReason.length) {
    console.log("");
    console.log("Unknown allow reasons:");
    for (const f of badReason) {
      console.log(`  ${f.file}:${f.line}  "${f.reason}"`);
    }
  }
}

// Run only when invoked as a CLI, so the unit test can import the scanner.
if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main(process.argv.slice(2));
}

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
//   --report          print a table, exit 0. Phase 0 runs this in npm run lint.
//   --strict <glob>   exit 1 on any flag in a matching file. Phase 2 moves
//                     files under --strict as it converts them, and ends with
//                     --strict "server/**".
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

/**
 * Pull every string and template literal out of a source file, with the line
 * it starts on. Comments are skipped so a SQL example in a comment is not
 * mistaken for a statement.
 */
function extractLiterals(source) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = source.length;

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
      continue;
    }
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
  // ** crosses path separators, * does not. Both are handled in one pass so
  // no placeholder character is needed.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*"));
  return new RegExp(`^${escaped}$`);
}

function main(argv) {
  const strictIndex = argv.indexOf("--strict");
  const strict = strictIndex !== -1;
  const glob = strict ? argv[strictIndex + 1] : null;
  const findings = scanProject("server");

  const unscoped = findings.filter((f) => f.severity === "unscoped");
  const badReason = findings.filter((f) => f.severity === "unknown-reason");

  if (strict) {
    if (!glob) {
      console.error(
        "tenant-lint: --strict needs a glob, e.g. --strict 'server/**'",
      );
      process.exit(2);
    }
    const re = globToRegExp(glob);
    const inScope = findings.filter((f) => re.test(f.file));
    for (const f of inScope) {
      console.error(`${f.file}:${f.line}  ${f.severity}  ${f.kind}  ${f.text}`);
    }
    if (inScope.length) {
      console.error(
        `\ntenant-lint: ${inScope.length} problem(s) in files matching ${glob}`,
      );
      process.exit(1);
    }
    console.log(`tenant-lint: clean for ${glob}`);
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

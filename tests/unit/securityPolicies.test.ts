// =============================================================================
// Unit: the CSP builder, the proxy hop count, the CSV formula guard, and the
// owner-only file modes
// =============================================================================

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  PERMISSIONS_POLICY,
  buildContentSecurityPolicy,
} from "../../server/utils/securityHeaders.ts";
import { trustProxyHops } from "../../server/utils/trustProxy.ts";
import { csvCell } from "../../server/services/exportService.ts";
import {
  PRIVATE_UMASK,
  makeDataPrivate,
} from "../../server/utils/privateFiles.ts";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  );

describe("buildContentSecurityPolicy", () => {
  it("keeps production strict: no inline script, no WebSocket source", () => {
    const csp = directives(buildContentSecurityPolicy({ origins: [] }));
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).not.toContain("ws:");
  });

  it("in dev, allows only what Vite needs and keeps every other directive", () => {
    const prod = directives(buildContentSecurityPolicy({ origins: [] }));
    const dev = directives(
      buildContentSecurityPolicy({ origins: [], dev: true }),
    );
    expect(dev["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(dev["connect-src"]).toContain("ws:");
    for (const name of [
      "default-src",
      "img-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
    ])
      expect(dev[name]).toEqual(prod[name]);
  });

  it("switches off the features no page uses", () => {
    expect(PERMISSIONS_POLICY).toContain("camera=()");
    expect(PERMISSIONS_POLICY).toContain("microphone=()");
    expect(PERMISSIONS_POLICY).not.toContain("publickey-credentials");
  });
});

describe("trustProxyHops", () => {
  it("is 0 when unset or empty", () => {
    expect(trustProxyHops(undefined)).toBe(0);
    expect(trustProxyHops("")).toBe(0);
    expect(trustProxyHops("  ")).toBe(0);
  });

  it("reads a whole number of hops", () => {
    expect(trustProxyHops("1")).toBe(1);
    expect(trustProxyHops(" 2 ")).toBe(2);
  });

  it("throws on anything else, so a typo stops the boot", () => {
    for (const bad of ["true", "-1", "1.5", "11", "loopback"])
      expect(() => trustProxyHops(bad)).toThrow(/TRUST_PROXY_HOPS/);
  });
});

describe("csvCell", () => {
  it("marks text that a spreadsheet would run as a formula", () => {
    expect(csvCell('=HYPERLINK("https://evil.example","x")')).toBe(
      `"'=HYPERLINK(""https://evil.example"",""x"")"`,
    );
    expect(csvCell("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
  });

  it("leaves ordinary text, numbers and empty cells alone", () => {
    expect(csvCell("Ada Lovelace")).toBe("Ada Lovelace");
    expect(csvCell("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("makeDataPrivate", () => {
  const originalUmask = process.umask();
  afterEach(() => {
    process.umask(originalUmask);
  });

  const mode = (p: string) => statSync(p).mode & 0o777;

  it("takes group and other access away from the data that exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "contrack-modes-"));
    for (const file of ["curator.db", "curator.db-wal", "secret.key"]) {
      writeFileSync(path.join(dir, file), "x");
      chmodSync(path.join(dir, file), 0o644);
    }
    for (const folder of ["uploads", "backups"]) {
      mkdirSync(path.join(dir, folder));
      chmodSync(path.join(dir, folder), 0o755);
    }

    expect(makeDataPrivate(dir)).toEqual([]);

    expect(mode(path.join(dir, "curator.db"))).toBe(0o600);
    expect(mode(path.join(dir, "curator.db-wal"))).toBe(0o600);
    expect(mode(path.join(dir, "secret.key"))).toBe(0o600);
    expect(mode(path.join(dir, "uploads"))).toBe(0o700);
    expect(mode(path.join(dir, "backups"))).toBe(0o700);
  });

  it("sets the umask, so a file written afterwards is owner-only", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "contrack-modes-"));
    makeDataPrivate(dir);
    expect(process.umask()).toBe(PRIVATE_UMASK);
    writeFileSync(path.join(dir, "later.db"), "x");
    mkdirSync(path.join(dir, "later"));
    expect(mode(path.join(dir, "later.db"))).toBe(0o600);
    expect(mode(path.join(dir, "later"))).toBe(0o700);
  });

  it("skips what is missing and leaves a stricter mode alone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "contrack-modes-"));
    writeFileSync(path.join(dir, "secret.key"), "x");
    chmodSync(path.join(dir, "secret.key"), 0o400);
    expect(makeDataPrivate(dir)).toEqual([]);
    expect(mode(path.join(dir, "secret.key"))).toBe(0o400);
  });
});

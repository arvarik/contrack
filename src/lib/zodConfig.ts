/**
 * zodConfig — zod without its `eval` probe, for the Content-Security-Policy.
 *
 * zod 4 compiles a fast parser for each object schema with `new Function`
 * when the page allows it, and finds out by trying once inside a `try`. The
 * policy has no `'unsafe-eval'`, so that try throws, zod falls back to the
 * plain parser, and the browser still reports a `securitypolicyviolation`
 * on every page load. `jitless` skips the probe and the compiled parser,
 * which this page could never use anyway.
 *
 * Imported first in main.tsx, because zod reads the setting when a schema is
 * built, and schemas are built as their modules load.
 *
 * @module lib/zodConfig
 */
import { config } from "zod";

config({ jitless: true });

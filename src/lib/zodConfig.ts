/**
 * zod without its `new Function` probe. The Content-Security-Policy has no
 * `'unsafe-eval'`, so the probe fails and still reports a
 * `securitypolicyviolation` on every load. Imported first in main.tsx,
 * because zod reads the setting as schemas are built.
 */
import { config } from "zod";

config({ jitless: true });

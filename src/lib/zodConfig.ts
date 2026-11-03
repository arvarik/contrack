/**
 * zod without its `new Function` probe. The Content-Security-Policy has no
 * `'unsafe-eval'`, so the probe fails and still reports a
 * `securitypolicyviolation` on every load. Imported first in main.tsx,
 * because zod reads the setting as schemas are built.
 *
 * zod keeps its settings in `globalThis.__zod_globalConfig` and takes the
 * object it finds there. Setting it here, without importing zod, keeps zod
 * off the first page load, and every chunk that loads zod later finds the
 * setting. `tests/unit/frontend/lib/zodConfig.test.ts` fails if zod moves it.
 */
const holder = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
(holder.__zod_globalConfig ??= {}).jitless = true;

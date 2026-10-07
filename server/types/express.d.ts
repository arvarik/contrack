// Type augmentation for Express's Request, all in one file, so whoever reads
// `req.` can find what is on it.
import type { Principal } from "../middleware/auth.ts";

declare global {
  namespace Express {
    interface Request {
      /** 8-char trace id stamped on every request by the middleware in server/app.ts. */
      requestId: string;
      /**
       * Who is making this request, set by `attachPrincipal` before any route
       * runs. Optional, because on a gated instance a caller that failed to
       * authenticate has none, which is what `requireAuth` checks.
       */
      principal?: Principal;
    }
  }
}

export {};

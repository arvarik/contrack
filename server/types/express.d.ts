// Type augmentation for Express's Request.
//
// One file for all of it, deliberately: `declare global` blocks scattered
// across the modules that happen to set each field are invisible to anyone
// reading `req.` and wondering what is on it.
import type { Principal } from "../middleware/auth.ts";

declare global {
  namespace Express {
    interface Request {
      /** 8-char trace id stamped on every request by the middleware in server/app.ts. */
      requestId: string;
      /**
       * Who is making this request — set by `attachPrincipal` before any
       * route runs. Optional because on a gated instance a caller that failed
       * to authenticate has no principal at all, which is what `requireAuth`
       * checks for.
       */
      principal?: Principal;
    }
  }
}

export {};

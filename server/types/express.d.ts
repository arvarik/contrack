// Type augmentation: the request-ID middleware in server.ts stamps every
// request with an 8-char trace id. Declaring it here removes the need for
// `req.requestId` casts at every call site.
declare global {
  namespace Express {
    interface Request {
      /** 8-char trace id stamped on every request by the middleware in server.ts. */
      requestId: string;
    }
  }
}

export {};

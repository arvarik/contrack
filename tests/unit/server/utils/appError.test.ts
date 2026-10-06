// Unit: the AppError class hierarchy, the contract every operational error
// honors:
//   - statusCode drives the HTTP response
//   - code is a stable machine-readable identifier
//   - details carries structured context (e.g. Zod issues)
//   - cause preserves the original error for forensics
//
// Service and middleware code branch on these. errorHandler.test.ts checks
// the shapes a client sees for NotFoundError, ValidationError and
// RateLimitedError after translation.

import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "../../../../server/utils/AppError.ts";

describe("AppError (base class)", () => {
  it("defaults statusCode to 500", () => {
    const e = new AppError("boom");
    expect(e.statusCode).toBe(500);
  });

  it("defaults code based on status when no explicit code is given", () => {
    expect(new AppError("x", 400).code).toBe("BAD_REQUEST");
    expect(new AppError("x", 401).code).toBe("UNAUTHORIZED");
    expect(new AppError("x", 403).code).toBe("FORBIDDEN");
    expect(new AppError("x", 404).code).toBe("NOT_FOUND");
    expect(new AppError("x", 409).code).toBe("CONFLICT");
    expect(new AppError("x", 422).code).toBe("UNPROCESSABLE");
    expect(new AppError("x", 429).code).toBe("RATE_LIMITED");
    expect(new AppError("x", 503).code).toBe("SERVICE_UNAVAILABLE");
    expect(new AppError("x", 504).code).toBe("TIMEOUT");
    expect(new AppError("x", 500).code).toBe("INTERNAL");
    expect(new AppError("x", 418).code).toBe("ERROR");
  });

  it("preserves the original error as `cause` without leaking it into `details`", () => {
    const original = new Error("network drop");
    const e = new AppError("wrapper", 503, { cause: original });
    expect((e as unknown as { cause: Error }).cause).toBe(original);
    expect(e.details).toBeUndefined();
  });

  it("sets `name` to the concrete subclass name (not 'Error')", () => {
    expect(new AppError("x").name).toBe("AppError");
    expect(new NotFoundError("Contact").name).toBe("NotFoundError");
    expect(new ValidationError("invalid").name).toBe("ValidationError");
  });
});

describe("Named subclasses", () => {
  it("NotFoundError without id omits the id from the message", () => {
    const e = new NotFoundError("Suggestion");
    expect(e.message).toBe("Suggestion not found");
    expect(e.details).toEqual({ entity: "Suggestion", id: undefined });
  });
});

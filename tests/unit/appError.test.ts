// =============================================================================
// Unit Tests — AppError class hierarchy (Phase 2 foundation)
// =============================================================================
// These tests pin down the contract that every operational error in the system
// is expected to honor:
//   - statusCode drives the HTTP response
//   - code is a stable machine-readable identifier
//   - details carries structured context (e.g. Zod issues)
//   - cause preserves the original error for forensics
//   - isOperational distinguishes expected errors from bugs
//
// Service-layer and middleware code branches on these properties. Breaking
// any of them is a contract violation that this file catches at CI time.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitedError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
} from "../../server/utils/AppError.ts";

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

  it("honors an explicit `code` option", () => {
    const e = new AppError("x", 500, { code: "DOMAIN_SPECIFIC" });
    expect(e.code).toBe("DOMAIN_SPECIFIC");
  });

  it("carries arbitrary structured `details`", () => {
    const e = new AppError("x", 400, {
      details: { field: "email", issue: "invalid" },
    });
    expect(e.details).toEqual({ field: "email", issue: "invalid" });
  });

  it("preserves the original error as `cause` without leaking it into `details`", () => {
    const original = new Error("network drop");
    const e = new AppError("wrapper", 503, { cause: original });
    expect((e as unknown as { cause: Error }).cause).toBe(original);
    expect(e.details).toBeUndefined();
  });

  it("marks errors as operational by default", () => {
    expect(new AppError("x").isOperational).toBe(true);
    expect(new AppError("x", 500, { isOperational: false }).isOperational).toBe(
      false,
    );
  });

  it("sets `name` to the concrete subclass name (not 'Error')", () => {
    expect(new AppError("x").name).toBe("AppError");
    expect(new NotFoundError("Contact").name).toBe("NotFoundError");
    expect(new ValidationError("invalid").name).toBe("ValidationError");
  });

  it("captures a usable stack trace", () => {
    const e = new AppError("x");
    expect(e.stack).toBeTypeOf("string");
    expect(e.stack).toContain("AppError");
  });
});

describe("Named subclasses", () => {
  it("NotFoundError → 404 + entity name in message", () => {
    const e = new NotFoundError("Contact", "c_123");
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("Contact c_123 not found");
    expect(e.details).toEqual({ entity: "Contact", id: "c_123" });
  });

  it("NotFoundError without id omits the id from the message", () => {
    const e = new NotFoundError("Suggestion");
    expect(e.message).toBe("Suggestion not found");
    expect(e.details).toEqual({ entity: "Suggestion", id: undefined });
  });

  it("ValidationError → 400 + carries arbitrary details (e.g. ZodError.issues)", () => {
    const issues = [{ path: ["email"], message: "Invalid email" }];
    const e = new ValidationError("Invalid request body", issues);
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.details).toBe(issues);
  });

  it("ConflictError → 409", () => {
    expect(new ConflictError("Already merged").statusCode).toBe(409);
    expect(new ConflictError("Already merged").code).toBe("CONFLICT");
  });

  it("RateLimitedError → 429", () => {
    expect(new RateLimitedError("Too many").statusCode).toBe(429);
    expect(new RateLimitedError("Too many").code).toBe("RATE_LIMITED");
  });

  it("ServiceUnavailableError → 503", () => {
    expect(new ServiceUnavailableError("AI down").statusCode).toBe(503);
    expect(new ServiceUnavailableError("AI down").code).toBe(
      "SERVICE_UNAVAILABLE",
    );
  });

  it("UpstreamTimeoutError → 504", () => {
    expect(new UpstreamTimeoutError("call exceeded 60s").statusCode).toBe(504);
    expect(new UpstreamTimeoutError("call exceeded 60s").code).toBe(
      "UPSTREAM_TIMEOUT",
    );
  });

  it("all subclasses are `instanceof AppError`", () => {
    expect(new NotFoundError("X")).toBeInstanceOf(AppError);
    expect(new ValidationError("X")).toBeInstanceOf(AppError);
    expect(new ConflictError("X")).toBeInstanceOf(AppError);
    expect(new RateLimitedError("X")).toBeInstanceOf(AppError);
    expect(new ServiceUnavailableError("X")).toBeInstanceOf(AppError);
    expect(new UpstreamTimeoutError("X")).toBeInstanceOf(AppError);
  });
});

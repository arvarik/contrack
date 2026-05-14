// =============================================================================
// Unit Tests — Central Express Error Middleware
// =============================================================================
// Verifies the contract every API client depends on:
//   - canonical { error: { code, message, requestId, details?, stack? } } shape
//   - status code mapping for AppError subclasses, ZodError, Express parse
//     errors, and known SQLite codes
//   - stack stripped in production, included in dev
//   - 404 fallback for unknown /api/ paths
//   - graceful no-op when headers were already sent (streaming routes)
//
// These tests use plain mock objects for req/res instead of supertest because
// we want to assert the middleware behavior in isolation — no Express plumbing,
// no real network.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZodError, z } from "zod";
import type { Request, Response, NextFunction } from "express";

import { errorHandler, notFoundHandler } from "../../server/middleware/errorHandler.ts";
import {
  AppError,
  NotFoundError,
  ValidationError,
  RateLimitedError,
} from "../../server/utils/AppError.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    originalUrl: "/api/test",
    path: "/api/test",
    ...overrides,
  } as Request;
}

function mockResponse() {
  const headersSent = { value: false };
  const res = {
    statusCode: 200,
    status: vi.fn().mockImplementation(function (this: Response, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    get headersSent() {
      return headersSent.value;
    },
    setHeadersSent(v: boolean) {
      headersSent.value = v;
    },
  } as unknown as Response & { setHeadersSent(v: boolean): void };
  return res;
}

// ---------------------------------------------------------------------------
// AppError translation
// ---------------------------------------------------------------------------

describe("errorHandler — AppError translation", () => {
  let prevEnv: string | undefined;
  beforeEach(() => {
    prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test"; // not production
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  it("maps NotFoundError to a 404 JSON body", () => {
    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(new NotFoundError("Contact", "c_123"), req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Contact c_123 not found");
    expect(body.error.details).toEqual({ entity: "Contact", id: "c_123" });
  });

  it("maps ValidationError to a 400 with details", () => {
    const req = mockRequest();
    const res = mockResponse();
    const issues = [{ path: ["email"], message: "Invalid email" }];

    errorHandler(new ValidationError("Bad body", issues), req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual(issues);
  });

  it("maps RateLimitedError to a 429", () => {
    const req = mockRequest();
    const res = mockResponse();

    errorHandler(new RateLimitedError("too many"), req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(429);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("emits requestId in the body when it's attached to the request", () => {
    const req = mockRequest({ originalUrl: "/api/test" });
    (req as Request & { requestId?: string }).requestId = "ab12cd34";
    const res = mockResponse();

    errorHandler(new NotFoundError("X"), req, res, vi.fn() as NextFunction);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.requestId).toBe("ab12cd34");
  });

  it("omits the requestId field entirely when none is set", () => {
    const req = mockRequest();
    const res = mockResponse();
    errorHandler(new NotFoundError("X"), req, res, vi.fn() as NextFunction);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error).not.toHaveProperty("requestId");
  });
});

// ---------------------------------------------------------------------------
// ZodError translation
// ---------------------------------------------------------------------------

describe("errorHandler — ZodError translation", () => {
  it("maps ZodError to a 400 with issue list", () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
    const zodError = (result as { success: false; error: ZodError }).error;

    const req = mockRequest();
    const res = mockResponse();

    errorHandler(zodError, req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Express + SQLite parse errors
// ---------------------------------------------------------------------------

describe("errorHandler — express/sqlite parse errors", () => {
  it("maps Express entity.parse.failed to 400 INVALID_JSON", () => {
    const req = mockRequest();
    const res = mockResponse();
    const parseErr = Object.assign(new Error("Unexpected token"), {
      type: "entity.parse.failed",
    });

    errorHandler(parseErr, req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("maps SQLITE_CONSTRAINT to 400 DB_CONSTRAINT", () => {
    const req = mockRequest();
    const res = mockResponse();
    const sqliteErr = Object.assign(new Error("UNIQUE constraint failed: contacts.email"), {
      code: "SQLITE_CONSTRAINT",
    });

    errorHandler(sqliteErr, req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("DB_CONSTRAINT");
    expect(body.error.details).toMatchObject({ sqliteMessage: expect.stringContaining("UNIQUE") });
  });

  it("maps SQLITE_BUSY to 503 DB_BUSY", () => {
    const req = mockRequest();
    const res = mockResponse();
    const sqliteErr = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });

    errorHandler(sqliteErr, req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("DB_BUSY");
  });
});

// ---------------------------------------------------------------------------
// Unknown errors → 500 with stack stripping
// ---------------------------------------------------------------------------

describe("errorHandler — unknown errors", () => {
  it("maps a bare Error to 500 INTERNAL", () => {
    const req = mockRequest();
    const res = mockResponse();
    errorHandler(new Error("oops"), req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("INTERNAL");
    // Generic message — never leak the raw thrown text.
    expect(body.error.message).toBe("Internal Server Error");
  });

  it("includes the stack in non-production environments", () => {
    process.env.NODE_ENV = "development";
    const req = mockRequest();
    const res = mockResponse();
    errorHandler(new Error("oops"), req, res, vi.fn() as NextFunction);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.stack).toContain("Error: oops");
  });

  it("strips the stack in production", () => {
    process.env.NODE_ENV = "production";
    const req = mockRequest();
    const res = mockResponse();
    errorHandler(new Error("oops"), req, res, vi.fn() as NextFunction);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error).not.toHaveProperty("stack");
  });
});

// ---------------------------------------------------------------------------
// Streaming-route safety: response already started
// ---------------------------------------------------------------------------

describe("errorHandler — already-sent headers", () => {
  it("ends the connection without writing JSON if headers were already sent", () => {
    const req = mockRequest();
    const res = mockResponse();
    res.setHeadersSent(true);

    errorHandler(new AppError("late error", 500), req, res, vi.fn() as NextFunction);

    expect(res.end).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// notFoundHandler
// ---------------------------------------------------------------------------

describe("notFoundHandler", () => {
  it("forwards an AppError 404 for unknown /api/ paths", () => {
    const req = mockRequest({ path: "/api/does-not-exist", method: "POST" });
    const res = mockResponse();
    const next = vi.fn();

    notFoundHandler(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(404);
    expect((err as AppError).code).toBe("ROUTE_NOT_FOUND");
  });

  it("passes through (no error) for non-/api/ paths", () => {
    const req = mockRequest({ path: "/dashboard", method: "GET" });
    const res = mockResponse();
    const next = vi.fn();

    notFoundHandler(req, res, next as NextFunction);

    // Should call next() with no arguments so the SPA fallback can run.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
  });
});

// =============================================================================
// Route recorder
// =============================================================================
// Express 5 does not keep mount path strings. `app.router` is a lazy getter,
// layers carry no `regexp`, and `layer.path` is only set after a successful
// `layer.match(url)`. Walking the stack alone therefore yields leaf paths with
// no prefix: `/reorder` instead of `/api/lists/reorder`.
//
// So the mount paths are recorded as they happen. `Router.prototype.use` and
// `application.use` are wrapped while `createApp()` runs, each string mount
// path is stored against the handle it mounted, and the stack walk then joins
// prefix to route path.
//
// Shape pinned against express@5.2.1 and router@2.2.0. The fields read here
// are `layer.route`, `route.path`, `route.methods`, `layer.name` and
// `layer.handle`, which are the stable ones.
// =============================================================================

import express from "express";

export interface RegisteredRoute {
  method: string;
  path: string;
  handlers: string[];
}

type Layer = {
  name?: string;
  route?: { path?: string; methods?: Record<string, boolean>; stack?: Layer[] };
  handle?: unknown;
};

/** Join a mount prefix and a route path into the path a client sends. */
function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}${path}`.replace(/\/{2,}/g, "/");
  if (joined.length > 1 && joined.endsWith("/")) return joined.slice(0, -1);
  return joined === "" ? "/" : joined;
}

/**
 * Build the app with `use` wrapped, then walk the router stack and return
 * every registered route with its full path.
 */
export function listRoutes(build: () => express.Express): RegisteredRoute[] {
  const mounts = new Map<unknown, string[]>();

  const record = (args: unknown[]): void => {
    const [first, ...rest] = args;
    const paths =
      typeof first === "string"
        ? [first]
        : Array.isArray(first) && first.every((p) => typeof p === "string")
          ? (first as string[])
          : null;
    if (!paths) return;
    for (const handle of rest) {
      const existing = mounts.get(handle) ?? [];
      mounts.set(handle, [...existing, ...paths]);
    }
  };

  const routerProto = express.Router.prototype as unknown as {
    use: (...args: unknown[]) => unknown;
  };
  // `express.application` is the prototype every app is created from.
  const appProto = (
    express as unknown as { application: { use: (...a: unknown[]) => unknown } }
  ).application;

  const originalRouterUse = routerProto.use;
  const originalAppUse = appProto.use;

  let app: express.Express;
  try {
    routerProto.use = function patched(...args: unknown[]) {
      record(args);
      return originalRouterUse.apply(this, args);
    };
    appProto.use = function patched(...args: unknown[]) {
      record(args);
      return originalAppUse.apply(this, args);
    };
    app = build();
  } finally {
    routerProto.use = originalRouterUse;
    appProto.use = originalAppUse;
  }

  const found: RegisteredRoute[] = [];
  const seen = new Set<string>();

  const push = (method: string, path: string, handlers: string[]): void => {
    const key = `${method} ${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ method, path, handlers });
  };

  const walk = (stack: Layer[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        const routePath = layer.route.path ?? "";
        const methods = Object.keys(layer.route.methods ?? {});
        const handlers = (layer.route.stack ?? []).map(
          (l) => (l.handle as { name?: string })?.name || "anonymous",
        );
        for (const m of methods) {
          push(m.toUpperCase(), joinPath(prefix, routePath), handlers);
        }
        continue;
      }

      // The express.static layer is middleware, not a route.
      if (layer.name === "serveStatic") {
        for (const p of mounts.get(layer.handle) ?? ["/"]) {
          push("USE", joinPath("", p), ["serveStatic"]);
        }
        continue;
      }

      // A mounted router. Recurse once per path it was mounted at.
      const nested = (layer.handle as { stack?: Layer[] })?.stack;
      if (layer.name === "router" && Array.isArray(nested)) {
        const paths = mounts.get(layer.handle) ?? [""];
        for (const p of paths) {
          walk(nested, joinPath(prefix, p === "/" ? "" : p));
        }
      }
    }
  };

  walk((app.router as unknown as { stack: Layer[] }).stack, "");
  return found.sort((a, b) =>
    a.path === b.path
      ? a.method.localeCompare(b.method)
      : a.path.localeCompare(b.path),
  );
}

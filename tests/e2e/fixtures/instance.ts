/**
 * ContrackInstance — a disposable production server for one worker.
 *
 * Boots `tsx server.ts` the way a release runs it: `NODE_ENV=production`,
 * serving `dist/`, with the security headers and the CSP on. Everything that
 * would reach the network or a developer's data is off: every provider key
 * is blank, background jobs are disabled, and DATA_DIR is a fresh temporary
 * directory that is deleted when the instance stops.
 *
 * Two shapes, chosen at start:
 *
 *   open   `AUTH_REQUIRED=false`. The local owner answers every request, so
 *          the API can be seeded with plain fetch and the app opens straight
 *          onto the network. One per worker.
 *
 *   gated  `AUTH_REQUIRED=true` and no account. The first visit is the setup
 *          wizard. One per test, because setup happens once per instance and
 *          the account journeys start there.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./paths";

const require = createRequire(import.meta.url);
/** tsx's command-line entry, resolved through its package exports. */
const TSX_CLI = require.resolve("tsx/cli");

const BOOT_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 5_000;

export interface InstanceOptions {
  /** Require an account. Defaults to an open instance. */
  authRequired?: boolean;
}

/** A free TCP port on the loopback interface. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ContrackInstance {
  readonly baseURL: string;
  readonly dataDir: string;
  private readonly child: ChildProcess;
  private readonly output: string[] = [];
  private exited: Promise<number | null>;

  private constructor(baseURL: string, dataDir: string, child: ChildProcess) {
    this.baseURL = baseURL;
    this.dataDir = dataDir;
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) =>
      this.output.push(chunk.toString()),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      this.output.push(chunk.toString()),
    );
    this.exited = new Promise((resolve) => child.once("exit", resolve));
  }

  /** Boot a server and resolve once `/healthz` answers. */
  static async start(options: InstanceOptions = {}): Promise<ContrackInstance> {
    const port = await freePort();
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "contrack-e2e-"));
    const baseURL = `http://127.0.0.1:${port}`;

    const child = spawn(process.execPath, [TSX_CLI, "server.ts"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        HOST: "127.0.0.1",
        DATA_DIR: dataDir,
        AUTH_REQUIRED: options.authRequired ? "true" : "false",
        // Empty rather than deleted: server modules load dotenv, and dotenv
        // fills only variables that are unset, so an empty value is what
        // keeps a developer's .env keys out of the run.
        GEMINI_API_KEY: "",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        MAPBOX_API_KEY: "",
        AI_EMBEDDINGS_MODEL: "",
        API_TOKEN: "",
        AUTH_TOKEN: "",
        CORS_ORIGIN: "",
        DISABLE_BACKGROUND_JOBS: "true",
        // The local embedding model would otherwise be fetched into the
        // developer's cache. Nothing in this suite embeds anything.
        TRANSFORMERS_CACHE: path.join(dataDir, ".cache"),
      },
    });

    const instance = new ContrackInstance(baseURL, dataDir, child);
    try {
      await instance.waitUntilHealthy();
    } catch (error) {
      await instance.stop();
      throw error;
    }
    return instance;
  }

  private async waitUntilHealthy(): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let exitCode: number | null | undefined;
    void this.exited.then((code) => (exitCode = code));
    while (Date.now() < deadline) {
      if (exitCode !== undefined) {
        throw new Error(
          `Contrack exited with code ${exitCode} before it was healthy.\n${this.log()}`,
        );
      }
      try {
        const res = await fetch(`${this.baseURL}/healthz`);
        if (res.ok) return;
      } catch {
        // Not listening yet.
      }
      await sleep(100);
    }
    throw new Error(
      `Contrack did not answer /healthz within ${BOOT_TIMEOUT_MS}ms.\n${this.log()}`,
    );
  }

  /** Everything the server wrote so far. Attached to a failing test. */
  log(): string {
    return this.output.join("");
  }

  /** How much the server had written, for `logSince`. */
  mark(): number {
    return this.output.length;
  }

  /** What the server wrote after `mark()` was taken. */
  logSince(mark: number): string {
    return this.output.slice(mark).join("");
  }

  /**
   * A JSON request against this instance, for seeding. Carries no cookie,
   * so on a gated instance it reaches only the pre-auth routes; the account
   * journeys use `page.request`, which shares the browser's cookie jar.
   */
  async api<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    route: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseURL}/api${route}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(
        `${method} /api${route} → ${res.status}: ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Stop the server and delete its data directory. Safe to call twice. */
  async stop(): Promise<void> {
    if (this.child.exitCode === null && !this.child.killed) {
      this.child.kill("SIGTERM");
      const timeout = sleep(STOP_TIMEOUT_MS).then(() => "timeout" as const);
      if ((await Promise.race([this.exited, timeout])) === "timeout") {
        this.child.kill("SIGKILL");
        await this.exited;
      }
    }
    await rm(this.dataDir, { recursive: true, force: true });
  }
}

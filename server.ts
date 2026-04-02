import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import crypto from "crypto";
import morgan from "morgan";
import fs from "fs";

import { log } from "./server/logger.ts";
import { startRetroactiveGeocoding } from "./server/geocoder.ts";

import { utilsRouter } from "./server/routes/utils.ts";
import { searchRouter } from "./server/routes/search.ts";
import { listsRouter } from "./server/routes/lists.ts";
import { contactsRouter } from "./server/routes/contacts.ts";
import { interactionsRouter } from "./server/routes/interactions.ts";
import { dedupeRouter } from "./server/routes/dedupe.ts";
import { mcpRouter } from "./server/routes/mcp.ts";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY || GEMINI_KEY === "dummy_key") {
  console.warn("\n\x1b[33m⚠️  [WARNING] GEMINI_API_KEY is not configured inside .env!\x1b[0m");
  console.warn("\x1b[33m   AI features (Briefings, Entity Extraction) will fail gracefully.\x1b[0m\n");
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

async function startServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use((req, res, next) => {
    (req as any).requestId = crypto.randomUUID().split("-")[0];
    next();
  });

  const morganFormat = process.env.NODE_ENV === "production" ? "short" : "dev";
  app.use(morgan(morganFormat, {
    skip: (req) => req.url.includes("node_modules") || req.url.includes("@vite") || req.url.includes("src/")
  }));

  app.use("/uploads", express.static(uploadDir));

  app.use("/api/utils", utilsRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/lists", listsRouter);
  app.use("/api", contactsRouter);
  app.use("/api", interactionsRouter);
  app.use("/api", mcpRouter);
  app.use("/api", dedupeRouter);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("Unhandled", `[${(req as any).requestId}] ${err.message}`);
    res.status(500).json({ error: "Internal Server Error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info("Server", `Contrack CRM running on http://localhost:${PORT}`);
    log.info("Server", `Database: curator.db | Uploads: ${uploadDir}`);
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });

  startRetroactiveGeocoding();
}

startServer();

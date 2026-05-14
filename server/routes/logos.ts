import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { log } from "../utils/logger.ts";

const router = Router();
const logosDir = path.join(process.cwd(), "uploads", "logos");

// Ensure the directory exists
if (!fs.existsSync(logosDir)) {
  fs.mkdirSync(logosDir, { recursive: true });
}

// In-memory cache of known failed domains to avoid repeating 404 requests to Clearbit
const knownFailedDomains = new Set<string>();

router.get("/:domain", async (req: Request, res: Response) => {
  const domain = String(req.params.domain);

  // Strict regex for valid domain names (letters, numbers, hyphens, and dots)
  // This inherently prevents path traversal (no slashes) and guarantees safe filenames.
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
  if (!domain || !domainRegex.test(domain)) {
    return res.status(400).send("Invalid domain");
  }

  const sanitizedDomain = domain.toLowerCase().trim();

  // Set long-lived cache control for browsers since logos rarely change
  res.setHeader("Cache-Control", "public, max-age=2592000"); // 30 days

  // Check memory cache for known 404s
  if (knownFailedDomains.has(sanitizedDomain)) {
    return res.status(404).send("Logo not found");
  }

  const filePath = path.join(logosDir, `${sanitizedDomain}.png`);

  try {
    // 1. Serve from local cache if it exists
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    // 2. Fetch from Google S2 Favicon API
    const googleS2Url = `https://www.google.com/s2/favicons?domain=${sanitizedDomain}&sz=128`;
    log.debug("Logo", `Fetching logo for ${sanitizedDomain} from Google S2...`);
    const response = await fetch(googleS2Url, { redirect: "follow" });

    if (!response.ok) {
      if (response.status === 404) {
        knownFailedDomains.add(sanitizedDomain);
      }
      return res
        .status(response.status)
        .send(`Failed to fetch logo: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Save to local file system
    await fs.promises.writeFile(filePath, buffer);

    // 4. Serve the fetched image
    res.setHeader("Content-Type", contentType);
    res.send(buffer);
  } catch (err: any) {
    log.error("Logo", `Error fetching logo for ${sanitizedDomain}: ${err}`);
    res.status(500).send(`Internal server error: ${err.message || err}`);
  }
});

export const logosRouter = router;

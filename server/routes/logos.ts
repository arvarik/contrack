// =============================================================================
// Company logos — fetched once from Google's favicon service, served from disk
// =============================================================================
// The browser asks GET /api/logos/<domain> and never talks to Google itself,
// so Google does not learn which companies are in somebody's contact list.
// The source is Google's S2 favicon service.
//
// Each domain is in one of three states on disk, in the shared LOGOS_DIR:
//   <domain>.png   The logo, validated and re-encoded here. Served forever.
//   <domain>.miss  Google answered "no" (a 4xx, or a body that is not an
//                  image). The file holds the time of that answer, and the
//                  domain is asked again after 30 days.
//   neither        Never asked, or the last attempt failed for a reason that
//                  says nothing about the domain: the network, a timeout, a
//                  5xx. Those failures back off for 10 minutes in memory only,
//                  so a restart, or the end of the backoff, asks again.
//
// Concurrent requests for one domain share one outbound fetch. A contact list
// renders many rows with the same employer at once, and before this each of
// them asked Google separately.
// =============================================================================

import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { LOGOS_DIR, ensureDir } from "../utils/paths.ts";
import { RequestCoalescer } from "../utils/requestCoalescer.ts";
import {
  fetchRemoteImage,
  isTransientImageError,
  writeFileAtomically,
  writeImageAtomically,
} from "../utils/remoteImage.ts";

const router = Router();
const logosDir = LOGOS_DIR;
ensureDir(logosDir);

/** The logo's bounding box, in pixels. Twice the largest size the UI draws. */
const LOGO_SIZE = 128;
/** A favicon is a few kilobytes. Anything near this cap is not a favicon. */
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_TIMEOUT_MS = 8_000;

/** How long a permanent miss on disk stands before the domain is asked again. */
export const LOGO_MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
/** How long a transient failure keeps a domain from being asked again. */
export const LOGO_TRANSIENT_BACKOFF_MS = 10 * 60 * 1000;

/**
 * Domains whose last fetch failed transiently, and when they may be asked
 * again. Memory only: a transient failure is a fact about this moment, not
 * about the domain, so it must not outlive the process.
 */
const transientUntil = new Map<string, number>();

/** Past this many entries, expired ones are dropped on the next insert. */
const TRANSIENT_PRUNE_AT = 1000;

const fills = new RequestCoalescer();

type LogoOutcome = "found" | "missing" | "unavailable";

/** True while a miss marker is younger than LOGO_MISS_RETRY_MS. */
function missIsFresh(missPath: string): boolean {
  let recorded: string;
  try {
    recorded = fs.readFileSync(missPath, "utf8");
  } catch {
    return false;
  }
  // A marker that does not parse is treated as expired, so a damaged file
  // costs one retry rather than hiding a logo forever.
  const at = Date.parse(recorded.trim());
  return Number.isFinite(at) && Date.now() - at < LOGO_MISS_RETRY_MS;
}

function rememberTransient(domain: string): void {
  const now = Date.now();
  if (transientUntil.size >= TRANSIENT_PRUNE_AT) {
    for (const [key, until] of transientUntil) {
      if (until <= now) transientUntil.delete(key);
    }
  }
  transientUntil.set(domain, now + LOGO_TRANSIENT_BACKOFF_MS);
}

/** Fetch, validate, re-encode and store one domain's logo. */
async function fillLogo(
  domain: string,
  filePath: string,
  missPath: string,
): Promise<LogoOutcome> {
  // A flight for this domain may have finished just before this one began.
  if (fs.existsSync(filePath)) return "found";

  const googleS2Url = `https://www.google.com/s2/favicons?domain=${domain}&sz=${LOGO_SIZE}`;
  log.debug("Logo", `Fetching logo for ${domain} from Google S2...`);
  try {
    const image = await fetchRemoteImage(googleS2Url, {
      maxBytes: LOGO_MAX_BYTES,
      timeoutMs: LOGO_TIMEOUT_MS,
    });
    // PNG keeps the transparency most favicons have. A small icon stays its
    // own size, because scaling it up adds bytes and no detail.
    await writeImageAtomically(image, filePath, (img) =>
      img
        .resize(LOGO_SIZE, LOGO_SIZE, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .png(),
    );
    transientUntil.delete(domain);
    await fs.promises.rm(missPath, { force: true });
    return "found";
  } catch (err) {
    if (isTransientImageError(err)) {
      rememberTransient(domain);
      log.warn(
        "Logo",
        `Logo for ${domain} is unavailable for now, retrying after ${LOGO_TRANSIENT_BACKOFF_MS / 60_000} minutes: ${getErrorMessage(err)}`,
      );
      return "unavailable";
    }
    try {
      await writeFileAtomically(missPath, new Date().toISOString());
    } catch (writeErr) {
      // The answer is still a miss. Without the marker the next request asks
      // Google again, which is the old behaviour and not a failure.
      log.warn(
        "Logo",
        `Could not record the logo miss for ${domain}: ${getErrorMessage(writeErr)}`,
      );
    }
    log.debug(
      "Logo",
      `No logo for ${domain}, asking again in 30 days: ${getErrorMessage(err)}`,
    );
    return "missing";
  }
}

/** Answer from disk or memory when possible, and fetch only when not. */
async function resolveLogo(
  domain: string,
  filePath: string,
  missPath: string,
): Promise<LogoOutcome> {
  if (fs.existsSync(filePath)) return "found";
  if (missIsFresh(missPath)) return "missing";

  const until = transientUntil.get(domain);
  if (until !== undefined) {
    if (until > Date.now()) return "unavailable";
    transientUntil.delete(domain);
  }

  // No caller signal: a browser that navigates away must not cancel a fetch
  // whose result every later request for this domain will use.
  return fills.coalesce(domain, () => fillLogo(domain, filePath, missPath));
}

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

  const filePath = path.join(logosDir, `${sanitizedDomain}.png`);
  const missPath = path.join(logosDir, `${sanitizedDomain}.miss`);

  try {
    const outcome = await resolveLogo(sanitizedDomain, filePath, missPath);
    if (outcome === "found") return res.sendFile(filePath);
    // A permanent miss keeps the 30-day header: the disk marker gives the
    // same answer for the same 30 days. 204, not 404: a company with no logo
    // is an answer, not an error, and a 404 put a red line in the browser's
    // console for every such row of the Network list. The image fails to
    // draw either way, and the row shows its initial.
    if (outcome === "missing") return res.status(204).end();
    // A transient failure says nothing about the domain, so the browser must
    // not keep this answer.
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).send("Logo temporarily unavailable");
  } catch (err) {
    log.error(
      "Logo",
      `Error fetching logo for ${sanitizedDomain}: ${getErrorMessage(err)}`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send("Internal server error");
  }
});

export const logosRouter = router;

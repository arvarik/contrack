# check=skip=SecretsUsedInArgOrEnv
# (BuildKit's linter flags the ENV name AUTH_REQUIRED as a possible secret.
#  It is a boolean feature flag; the directive silences the false positive so
#  a first-time builder doesn't see a scary "secrets" warning.)

# Node 26 on Debian 13 (trixie), the current Debian stable. Debian 12
# (bookworm) moved to reduced LTS support in June 2026. The tag names the
# major line only, so a rebuild takes each 26.x security release; package.json
# requires 26.10 or later.

# Stage 1: Build the frontend
FROM node:26-trixie AS builder

WORKDIR /app

# Install dependencies. ONNXRUNTIME_NODE_INSTALL=skip stops onnxruntime-node
# from downloading its CUDA 12 binaries from NuGet on linux/x64, as CI already
# does. The embedding model runs on the CPU, so those files were never loaded.
COPY package.json package-lock.json ./
RUN ONNXRUNTIME_NODE_INSTALL=skip npm ci

# Download the two local search models here, at build time, so a container
# never reaches huggingface.co. The script checks each file's SHA-256 against
# the pinned list in modelFiles.ts. Only these three files are copied first,
# so a code change elsewhere reuses this layer instead of downloading again.
# The script reads `.env` through loadEnv.ts. `.dockerignore` keeps `.env`
# out of the image, so here that reads nothing.
COPY scripts/fetch-models.ts ./scripts/
COPY server/services/search/modelFiles.ts ./server/services/search/
COPY server/utils/loadEnv.ts ./server/utils/
RUN node scripts/fetch-models.ts /app/models

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production runtime
# No apt packages needed: better-sqlite3 bundles its own SQLite, and Node
# ships with a built-in CA store for outbound TLS.
FROM node:26-trixie-slim AS runtime

WORKDIR /app

# Install production dependencies. Node runs the TypeScript itself, so there
# is no TypeScript loader to install.
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare \
    && ONNXRUNTIME_NODE_INSTALL=skip npm ci --omit=dev \
    && npm cache clean --force

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist
# The search models. MODEL_DIR below points the server at them, and
# MODEL_DOWNLOADS=false keeps it from downloading anything else.
COPY --from=builder /app/models ./models

# Copy the backend. The database schema and its migrations live in
# server/db/. The server imports shared/ at runtime (the MCP tools,
# connectors, dates, geo), so it ships too; without it the image failed at
# boot with ERR_MODULE_NOT_FOUND.
COPY server/ ./server/
COPY shared/ ./shared/
COPY server.ts ./
# The documented password recovery, `docker exec -it contrack node
# scripts/reset-password.ts <username>`, runs this file. The image had no
# scripts/, so the command could not work in a container.
COPY scripts/reset-password.ts ./scripts/

# Configure environment variables
# AUTH_REQUIRED defaults to false: the common deployment is a container reached
# only from the host or behind a reverse proxy that does its own auth, and a
# generated token nobody asked for is friction in that case.
#
# NOTE the trade-off — the container binds 0.0.0.0, so with auth off it is
# reachable from anything that can route to the published port. If the port is
# exposed beyond the host, turn auth on:
#   -e AUTH_REQUIRED=true      require sign-in; first visit creates the account
# Scripts and MCP clients then use a personal token from Settings → Account →
# API tokens.
# The server logs a warning at startup whenever it binds a non-loopback address
# with auth off.
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=3210 \
    HOST=0.0.0.0 \
    AUTH_REQUIRED=false \
    MODEL_DIR=/app/models \
    MODEL_DOWNLOADS=false

# Create the data directory and drop root privileges
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3210

# /healthz sits outside the auth gate, so this works on a gated instance too.
# `restart: unless-stopped` only reacts to a dead process; the health check is
# what catches a process that is alive but no longer answering. start-period
# covers first-boot migrations and the embedding model load. No curl in the
# slim image — Node's own fetch does the probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3210)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node 26 strips the types and runs server.ts, with no loader. It is one
# process, so SIGTERM from `docker stop` reaches the server, which drains its
# connections and closes the database.
CMD ["node", "server.ts"]

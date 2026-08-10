# check=skip=SecretsUsedInArgOrEnv
# (BuildKit's linter flags the ENV name AUTH_REQUIRED as a possible secret.
#  It is a boolean feature flag; the directive silences the false positive so
#  a first-time builder doesn't see a scary "secrets" warning.)

# Stage 1: Build the frontend
FROM node:22-bookworm AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production runtime
# No apt packages needed: better-sqlite3 bundles its own SQLite, and Node
# ships with a built-in CA store for outbound TLS.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Install production dependencies + tsx to execute the TypeScript server
COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev --legacy-peer-deps \
    && npm install -g tsx@4 \
    && npm cache clean --force

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy backend and database configurations
COPY server/ ./server/
COPY src/db/ ./src/db/
COPY drizzle/ ./drizzle/
COPY server.ts drizzle.config.ts ./

# Configure environment variables
# AUTH_REQUIRED defaults to false: the common deployment is a container reached
# only from the host or behind a reverse proxy that does its own auth, and a
# generated token nobody asked for is friction in that case.
#
# NOTE the trade-off — the container binds 0.0.0.0, so with auth off it is
# reachable from anything that can route to the published port. If the port is
# exposed beyond the host, turn auth on:
#   -e AUTH_REQUIRED=true      require sign-in; first visit creates the account
#   -e API_TOKEN=<secret>      machine credential for scripts/MCP; also gates
# The server logs a warning at startup whenever it binds a non-loopback address
# with auth off.
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    TRANSFORMERS_CACHE=/app/data/.cache \
    PORT=3210 \
    HOST=0.0.0.0 \
    AUTH_REQUIRED=false

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

CMD ["tsx", "server.ts"]

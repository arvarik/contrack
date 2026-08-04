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
# AUTH_REQUIRED: the container binds 0.0.0.0, so auth is on by default.
# A token is generated on first boot, persisted to /app/data/auth-token,
# and printed in the container logs. Override with AUTH_TOKEN, or opt out
# with AUTH_REQUIRED=false.
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    TRANSFORMERS_CACHE=/app/data/.cache \
    PORT=3210 \
    HOST=0.0.0.0 \
    AUTH_REQUIRED=true

# Create the data directory and drop root privileges
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3210

CMD ["tsx", "server.ts"]

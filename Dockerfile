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
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Ensure native bindings can run
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Install tsx globally to execute TypeScript server
RUN npm install -g tsx

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy backend and database configurations
COPY server/ ./server/
COPY src/db/ ./src/db/
COPY drizzle/ ./drizzle/
COPY server.ts ./
COPY drizzle.config.ts ./

# Configure environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV TRANSFORMERS_CACHE=/app/data/.cache
ENV PORT=3210

# Create the data directory
RUN mkdir -p /app/data

# Expose the default port
EXPOSE 3210

# Start the application
CMD ["tsx", "server.ts"]

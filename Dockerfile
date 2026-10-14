# check=skip=SecretsUsedInArgOrEnv
# (BuildKit's linter flags the ENV name AUTH_REQUIRED as a possible secret.
#  It is a boolean feature flag; the directive silences the false positive so
#  a first-time builder doesn't see a scary "secrets" warning.)

# Node 26 on Debian 13 (trixie), the current Debian stable. Debian 12
# (bookworm) moved to reduced LTS support in June 2026. The tag names the
# major line and is pinned by its multi-arch SHA-256 digest (updated weekly
# by Dependabot); package.json requires 26.10 or later.

# Stage 1: Build the frontend
FROM node:26-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4 AS builder

WORKDIR /app

# Download the two local search models here, at build time, so a container
# never reaches huggingface.co. The script checks each file's SHA-256 against
# the pinned list in modelFiles.ts. Only these three files are copied first,
# so a code or dependency change elsewhere reuses this layer instead of
# downloading again. The script reads `.env` through loadEnv.ts.
# `.dockerignore` keeps `.env` out of the image, so here that reads nothing.
COPY scripts/fetch-models.ts ./scripts/
COPY server/services/search/modelFiles.ts ./server/services/search/
COPY server/utils/loadEnv.ts ./server/utils/
RUN node scripts/fetch-models.ts /app/models

# Install dependencies. --ignore-scripts skips lifecycle install scripts:
# better-sqlite3 13+ and onnxruntime-node already ship prebuilt Linux binaries
# inside their tarballs, and node:26-trixie-slim has no Python for node-gyp.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && rm -rf /root/.npm

# Copy frontend build inputs and build
COPY index.html vite.config.ts tsconfig.json ./
COPY public/ ./public/
COPY shared/ ./shared/
COPY src/ ./src/
RUN npm run build

# Stage 2: Production runtime
# No apt packages needed: better-sqlite3 bundles its own SQLite, and Node
# ships with a built-in CA store for outbound TLS.
FROM node:26-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4 AS runtime

WORKDIR /app

# Install production dependencies. Node runs the TypeScript itself, so there
# is no TypeScript loader to install, and the browser's packages are
# devDependencies, which the build stage bundled into dist/.
#
# The same step removes what this image can never load. It has to be the same
# step: a file removed in a later step still ships in this layer.
# - onnxruntime-node and better-sqlite3 carry native libraries for macOS,
#   Windows and Linux on both CPUs. A container is always Linux (glibc), and
#   each image is built for one CPU, so only linux/<this CPU> stays. The step
#   fails if either binary is missing.
# - onnxruntime-web is the browser runtime. @huggingface/transformers lists
#   it, but its Node build loads onnxruntime-node and never imports it.
# - Unreachable transitive packages, non-Node/non-SQLite bundles, C/C++ and
#   TypeScript sources, type declarations, source maps and markdown docs in
#   node_modules are never loaded at runtime.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && ort=node_modules/onnxruntime-node/bin/napi-v6 \
    && keep="linux/$(node -p process.arch)" \
    && test -f "$ort/$keep/onnxruntime_binding.node" \
    && find "$ort" -mindepth 2 -maxdepth 2 -type d ! -path "$ort/$keep" -exec rm -rf {} + \
    && find "$ort" -mindepth 1 -maxdepth 1 -type d -empty -delete \
    && bsq=node_modules/better-sqlite3/prebuilds \
    && bsq_keep="linux-$(node -p process.arch).node" \
    && test -f "$bsq/$bsq_keep" \
    && find "$bsq" -maxdepth 1 -type f ! -name "$bsq_keep" -delete \
    && rm -rf /root/.npm package-lock.json \
         node_modules/onnxruntime-web \
         node_modules/web-streams-polyfill \
         node_modules/protobufjs \
         node_modules/@types \
         node_modules/better-sqlite3/deps \
         node_modules/better-sqlite3/src \
         node_modules/openai/src \
         node_modules/@anthropic-ai/sdk/src \
         node_modules/zod/src \
         node_modules/@google/genai/dist/web \
         node_modules/@google/genai/dist/tokenizer \
         node_modules/@google/genai/dist/vertex_internal \
         node_modules/@huggingface/transformers/src \
         node_modules/@huggingface/transformers/types \
         node_modules/cheerio/node_modules/undici \
         node_modules/parse5* \
    && find node_modules/@huggingface/transformers/dist -type f ! -name 'transformers.node.mjs' -delete \
    && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' -o -name '*.md' \) -delete

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
# Loads both search models and uses each once (see below).
COPY scripts/model-smoke.ts ./scripts/

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
    NODE_COMPILE_CACHE=/app/.compile-cache \
    DATA_DIR=/app/data \
    PORT=3210 \
    HOST=0.0.0.0 \
    AUTH_REQUIRED=false \
    MODEL_DIR=/app/models \
    MODEL_DOWNLOADS=false

# Prove the trimmed image still runs its search models and boots the server
# module graph on the CPU it is for, while warming NODE_COMPILE_CACHE. The
# temporary folder is removed in the same step so nothing stays in the layer.
RUN mkdir -p /tmp/model-smoke/data \
    && TRANSFORMERS_CACHE=/tmp/model-smoke node scripts/model-smoke.ts \
    && DATA_DIR=/tmp/model-smoke/data DISABLE_BACKGROUND_JOBS=true DISABLE_CPU_WORKER=true \
       node --input-type=module -e 'await import("./server/app.ts"); await import("@google/genai"); await import("openai"); await import("@anthropic-ai/sdk"); process.exit(0)' \
    && rm -rf /tmp/model-smoke

# Create the data and compile-cache directories and drop root privileges. npm
# and npx built the dependencies above and nothing runs them after that. Their
# files stay in the base image's layer, so removing them saves no space, but
# it takes them, and the findings an image scan reports inside them, out of
# the container.
RUN mkdir -p /app/data /app/.compile-cache \
    && chown -R node:node /app/data /app/.compile-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
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

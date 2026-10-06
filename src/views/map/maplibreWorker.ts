/**
 * The URL of MapLibre's web worker. MapLibre looks for it beside its own
 * module, which the bundler moves into a chunk, so the default URL is a 404
 * in production. Vite's `?worker&url` emits one same-origin file, which the
 * CSP's `worker-src 'self'` allows.
 */
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

export const MAPLIBRE_WORKER_URL: string = workerUrl;

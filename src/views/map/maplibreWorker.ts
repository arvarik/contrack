/**
 * The URL of MapLibre's web worker in this build.
 *
 * MapLibre finds its worker next to its own module file. A bundler moves that
 * module into a chunk and does not copy the worker beside it, so the default
 * URL answers 404 in the production build. Vite's `?worker&url` bundles the
 * worker with its shared code into one same-origin file and returns its URL,
 * which the map passes to MapLibre through the `workerUrl` prop. Same origin
 * is what `worker-src 'self'` in the production CSP allows.
 *
 * @module views/map/maplibreWorker
 */
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

export const MAPLIBRE_WORKER_URL: string = workerUrl;

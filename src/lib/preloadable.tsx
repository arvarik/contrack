/**
 * preloadable: a lazy component that renders at once when its code is
 * already loaded.
 *
 * `React.lazy` suspends on its first render even when the module is in
 * memory: it has only a promise, and a promise cannot be read at once. In a
 * Suspense boundary that is new on screen, React then shows the fallback
 * and keeps the page back until 300 ms after it (React's fallback
 * throttle). That is why Settings took 350 ms to open from the Network page
 * with its code already downloaded, and why the Account page showed
 * "Loading…" for 310 ms when opened from the settings list.
 *
 * 1. `load()` starts the download, once, and keeps the module when it
 *    arrives. A failed download is forgotten, so the next call tries again.
 * 2. `Component` picks, when it mounts, the loaded module's component if
 *    there is one, and the lazy component if not. It keeps that pick while
 *    it stays mounted, so a page on screen never changes its component type
 *    (which would remount it and lose what was typed in it).
 *
 * @module lib/preloadable
 */
import React, { useState } from "react";

/** A module with a component as its default export. */
export interface ComponentModule<P extends object> {
  default: React.ComponentType<P>;
}

export interface Preloadable<
  P extends object,
  M extends ComponentModule<P> = ComponentModule<P>,
> {
  /** Starts the download, and resolves with the module. */
  load: () => Promise<M>;
  /** The component: at once when loaded, through Suspense when not. */
  Component: React.ComponentType<P>;
  /** The loaded module, or null before the download ends. */
  loaded: () => M | null;
}

export function preloadable<
  P extends object,
  M extends ComponentModule<P> = ComponentModule<P>,
>(factory: () => Promise<M>): Preloadable<P, M> {
  let loadedModule: M | null = null;
  let pending: Promise<M> | null = null;

  const load = () => {
    pending ??= factory().then(
      (module) => {
        loadedModule = module;
        return module;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  const Lazy = React.lazy<React.ComponentType<P>>(load);

  function PreloadableComponent(props: P) {
    const [Picked] = useState<React.ComponentType<P>>(
      () => loadedModule?.default ?? (Lazy as React.ComponentType<P>),
    );
    return <Picked {...props} />;
  }

  return {
    load,
    Component: PreloadableComponent,
    loaded: () => loadedModule,
  };
}

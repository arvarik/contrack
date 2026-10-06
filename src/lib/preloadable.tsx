/**
 * A lazy component that renders at once when its code is already loaded.
 * `React.lazy` suspends on its first render even then, and a new Suspense
 * boundary holds its fallback for 300 ms (React's throttle).
 *
 * 1. `load()` starts the download once and keeps the module. A failed
 *    download is forgotten, so the next call tries again.
 * 2. `Component` picks, at mount, the loaded component or the lazy one, and
 *    keeps that pick, so a page on screen never changes its component type
 *    and loses what was typed in it.
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

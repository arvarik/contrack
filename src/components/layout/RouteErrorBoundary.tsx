/**
 * RouteErrorBoundary — View-level error boundary for individual routes.
 *
 * Unlike the root ErrorBoundary (which shows a full-page crash screen),
 * this component catches errors within a single route and renders an
 * inline recovery UI. The rest of the app (sidebar, nav) remains functional.
 *
 * Usage:
 *   <RouteErrorBoundary>
 *     <SomeView />
 *   </RouteErrorBoundary>
 */
import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, CloudOff, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional label for error logging context. */
  viewName?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * True when the boundary caught a failed `React.lazy` chunk download rather
 * than a genuine crash in the view.
 *
 * This matters because the two need opposite messages. Every secondary route
 * is code-split, so navigating to one the user has not opened yet while the
 * server is restarting throws here — and reporting "this view crashed
 * unexpectedly" for what is really a network blip sends the user hunting for a
 * bug that does not exist. Browsers word it differently, hence the alternatives.
 */
function isChunkLoadError(error?: Error): boolean {
  if (!error) return false;
  const message = `${error.name}: ${error.message}`;
  return (
    /dynamically imported module/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk .* failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

export class RouteErrorBoundary extends Component<Props, State> {
  declare props: Readonly<Props>;
  declare setState: Component<Props, State>["setState"];
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[RouteErrorBoundary${this.props.viewName ? `: ${this.props.viewName}` : ""}]`,
      error,
      info,
    );
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  /**
   * A failed chunk cannot be re-imported: the module registry caches the
   * rejection, so simply clearing the boundary re-throws immediately. A full
   * reload is the only reliable recovery — and it is also what the user wants
   * after a deploy, since it picks up the new bundle.
   */
  private handleReload = () => {
    window.location.reload();
  };

  public override render() {
    if (this.state.hasError) {
      const isChunk = isChunkLoadError(this.state.error);

      return (
        <div className="flex items-center justify-center h-full p-8 text-on-surface">
          <div className="max-w-sm w-full text-center space-y-4">
            <div
              className={
                isChunk
                  ? "w-12 h-12 bg-warning/10 text-warning rounded-full flex items-center justify-center mx-auto"
                  : "w-12 h-12 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto"
              }
            >
              {isChunk ? (
                <CloudOff className="w-6 h-6" />
              ) : (
                <AlertCircle className="w-6 h-6" />
              )}
            </div>
            <h2 className="text-lg font-bold font-headline">
              {isChunk ? "Couldn't load this page" : "Something went wrong"}
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {isChunk
                ? "Contrack couldn't download the rest of the app — the server may be restarting. Your data is safe."
                : "This view crashed unexpectedly. The rest of the app is still working — you can retry or navigate elsewhere."}
            </p>
            {/*
              The raw message helps on a real crash and only confuses on a
              network blip, where it says "Failed to fetch dynamically imported
              module" — true, and meaningless to the person reading it.
            */}
            {!isChunk && this.state.error && (
              <div className="bg-surface-container-highest p-3 rounded-xl text-left overflow-x-auto text-xs font-mono text-error">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={isChunk ? this.handleReload : this.handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-sm hover:opacity-90 transition-opacity shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              {isChunk ? "Reload" : "Retry"}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

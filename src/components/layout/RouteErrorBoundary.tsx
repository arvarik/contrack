/**
 * Catches an error inside one route and shows a recovery in its place, so
 * the sidebar and the nav keep working. The root ErrorBoundary is the
 * full-page one.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, CloudOff, RefreshCw, RotateCcw } from "lucide-react";
import { TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";

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
 * True for a failed `React.lazy` chunk download, not a crash in the view: a
 * network blip needs a different message. Browsers word it differently,
 * hence the alternatives.
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
   * A full reload: the module registry caches a failed chunk's rejection,
   * so clearing the boundary would throw again. It also picks up a new
   * deploy.
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
              className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center mx-auto",
                TONE_WASH[isChunk ? "warning" : "error"],
              )}
            >
              {isChunk ? (
                <CloudOff className="w-6 h-6" />
              ) : (
                <AlertCircle className="w-6 h-6" />
              )}
            </div>
            <h2 className="text-lg font-bold font-headline">
              {isChunk ? "Could not load this page" : "Something went wrong"}
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {isChunk
                ? "Contrack could not download the rest of the app. The server may be restarting. Your data is safe"
                : "This page hit an error. The rest of Contrack still works, so retry or go to another page"}
            </p>
            {/* The raw message helps on a crash, not on a network blip. */}
            {!isChunk && this.state.error && (
              <div className="bg-surface-container-highest p-3 rounded-xl text-left overflow-x-auto text-xs font-mono text-error">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={isChunk ? this.handleReload : this.handleRetry}
              className="btn-primary"
            >
              {/* A reload in the app-wide error screen's words and glyph. */}
              {isChunk ? (
                <RefreshCw aria-hidden="true" className="w-4 h-4" />
              ) : (
                <RotateCcw aria-hidden="true" className="w-4 h-4" />
              )}
              {isChunk ? "Reload the page" : "Try again"}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

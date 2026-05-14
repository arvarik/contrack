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
import { AlertCircle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional label for error logging context. */
  viewName?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class RouteErrorBoundary extends Component<Props, State> {
  declare props: Readonly<Props>;
  declare setState: Component<Props, State>["setState"];
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[RouteErrorBoundary${this.props.viewName ? `: ${this.props.viewName}` : ""}]`,
      error,
      info,
    );
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-8 text-on-surface">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-12 h-12 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold font-headline">
              Something went wrong
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              This view crashed unexpectedly. The rest of the app is still
              working — you can retry or navigate elsewhere.
            </p>
            {this.state.error && (
              <div className="bg-surface-container-highest p-3 rounded-xl text-left overflow-x-auto text-xs font-mono text-error">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-sm hover:bg-primary/90 transition-colors shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

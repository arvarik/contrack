import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  declare props: Readonly<Props>;
  public override state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-6 text-on-surface">
          <div className="max-w-md w-full bg-surface-container-low rounded-3xl p-8 shadow-xl text-center">
            <div className="w-16 h-16 bg-red-500/10 text-error rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-extrabold font-headline mb-3">
              System Crash
            </h1>
            <p className="text-on-surface-variant mb-6 text-sm">
              The application encountered an unexpected error. This has been
              logged for review.
            </p>
            {this.state.error && (
              <div className="bg-surface-container-highest p-4 rounded-xl text-left mb-6 overflow-x-auto text-xs font-mono text-error">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={() => (window.location.href = "/")}
              className="w-full bg-primary text-on-primary font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

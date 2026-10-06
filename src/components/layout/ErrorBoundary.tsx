import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { CorvidMark } from "../brand/CorvidMark";

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
            <div
              className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6",
                TONE_WASH.error,
              )}
            >
              <AlertCircle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-extrabold font-headline mb-3">
              Something went wrong
            </h1>
            {/* No "logged for review": on a self-hosted app nobody reviews
                the browser's console. */}
            <p className="text-on-surface-variant mb-6 text-sm">
              Contrack hit an error it did not expect. Reload the page to try
              again. Your data is safe
            </p>
            {this.state.error && (
              <div className="bg-surface-container-highest p-4 rounded-xl text-left mb-6 overflow-x-auto text-xs font-mono text-error">
                {this.state.error.message}
              </div>
            )}
            {/* The page that failed, not the start page. */}
            <button
              onClick={() => window.location.reload()}
              className="btn-primary w-full"
            >
              <RefreshCw className="w-4 h-4" />
              Reload the page
            </button>
            {/* The mark small in the footer, not as a mascot: on a crash it
                would read as a joke. */}
            <div className="mt-6 flex justify-center text-on-surface-variant">
              <CorvidMark size={20} />
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logger as clientLogger } from '@/lib/client-logger';

interface Props {
    children: ReactNode;
    /** Optional label shown in the error message, e.g. "Библиотека" */
    name?: string;
}

interface State {
    error: Error | null;
}

/**
 * Generic error boundary for route-level components.
 *
 * Catches unhandled React render errors in any child subtree and displays
 * a user-friendly fallback instead of a blank / crashed screen.
 * Errors are also forwarded to the client logger for diagnostics.
 *
 * @example
 * ```tsx
 * <RouteErrorBoundary name="Библиотека">
 *   <LibraryPage />
 * </RouteErrorBoundary>
 * ```
 */
export class RouteErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: { componentStack: string }) {
        clientLogger.error(
            `[RouteErrorBoundary] Unhandled render error${this.props.name ? ` in ${this.props.name}` : ''}`,
            error,
            info.componentStack
        );
    }

    private handleRetry = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
                <div className="max-w-md w-full rounded-xl border border-red-500/30 bg-red-500/10 p-6 space-y-4">
                    <div className="flex items-center justify-center gap-2 text-red-400">
                        <AlertTriangle className="w-6 h-6 flex-shrink-0" />
                        <span className="text-lg font-semibold">
                            {this.props.name
                                ? `Ошибка в разделе «${this.props.name}»`
                                : 'Непредвиденная ошибка'}
                        </span>
                    </div>
                    <p className="text-sm text-red-300/70 font-mono break-all">
                        {error.message}
                    </p>
                    <button
                        onClick={this.handleRetry}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-muted text-foreground text-sm transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Попробовать снова
                    </button>
                </div>
            </div>
        );
    }
}

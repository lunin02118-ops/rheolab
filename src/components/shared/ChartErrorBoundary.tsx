import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logger } from '@/lib/logger';

interface Props {
    children: ReactNode;
    /** Fallback height so the boundary doesn't collapse to 0 */
    height?: number;
}

interface State {
    error: Error | null;
}

/**
 * Lightweight error boundary for chart components (uPlot / canvas).
 *
 * Prevents a single chart crash from tearing down the entire route.
 * Renders an inline error card with a "retry" button that resets state.
 */
export class ChartErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: { componentStack: string }) {
        logger.error('[ChartErrorBoundary] Chart render error', error, info.componentStack);
    }

    private handleRetry = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div
                className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center"
                style={{ minHeight: this.props.height ?? 300 }}
            >
                <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
                <p className="text-sm text-red-300 mb-1">Ошибка отрисовки графика</p>
                <p className="text-xs text-red-400/60 font-mono mb-4 max-w-md break-all">
                    {error.message}
                </p>
                <button
                    onClick={this.handleRetry}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary hover:bg-muted text-foreground text-xs transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Повторить
                </button>
            </div>
        );
    }
}

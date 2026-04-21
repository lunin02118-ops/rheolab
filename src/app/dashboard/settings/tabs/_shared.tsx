/**
 * Shared primitives for settings tabs:
 *   * TabLoader — Suspense fallback spinner
 *   * SettingsErrorBoundary — per-section error boundary with retry
 */
import { Component, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

export function TabLoader() {
    return (
        <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
    );
}

interface SettingsErrorBoundaryProps {
    children: ReactNode;
    name: string;
}

export class SettingsErrorBoundary extends Component<SettingsErrorBoundaryProps, { error: Error | null }> {
    state: { error: Error | null } = { error: null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return (
                <div className="p-4 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-medium">Ошибка в разделе «{this.props.name}»</span>
                    </div>
                    <p className="text-xs text-red-600/70 dark:text-red-400/70 font-mono">{this.state.error.message}</p>
                    <button
                        className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={() => this.setState({ error: null })}
                    >
                        Попробовать снова
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

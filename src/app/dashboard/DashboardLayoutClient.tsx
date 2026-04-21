import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { Link, useLocation } from 'react-router-dom';
import { Logo } from '@/components/ui/logo';
import { UIModeToggle } from '@/components/layout/ui-mode-toggle';
import { LicenseStatusBadge } from '@/components/licensing/LicenseStatusBadge';
import { LicenseGuard } from '@/components/licensing/LicenseGuard';
import { useLicenseStore } from '@/lib/store/license-store';
import { useComparisonStore } from '@/lib/store/comparison-store';
import { clearAnalysisCache } from '@/hooks/analysisCache';
import { UpdateBanner } from '@/components/shared/UpdateBanner';

// Lazy-load licensing UI that is only shown conditionally (trial / activation)
const TrialBanner = lazy(() => import('@/components/licensing/TrialBanner').then(m => ({ default: m.TrialBanner })));
const LicenseActivationDialog = lazy(() => import('@/components/licensing/LicenseActivationDialog').then(m => ({ default: m.LicenseActivationDialog })));

// UpdateChecker is a background worker (30 s delay before first check).
// Deferring its bundle removes Tauri updater/process/event plugins
// from the main chunk.
const UpdateChecker = lazy(() => import('@/components/shared/UpdateChecker').then(m => ({ default: m.UpdateChecker })));

interface DashboardLayoutClientProps {
    children: React.ReactNode;
}

export function DashboardLayoutClient({ children }: DashboardLayoutClientProps) {
    const [showActivation, setShowActivation] = useState(false);
    const isInitialized = useLicenseStore(s => s.isInitialized);
    const refresh = useLicenseStore(s => s.refresh);
    const { pathname } = useLocation();
    const previousPathRef = useRef(pathname);

    // Trigger license store init once on mount.
    useEffect(() => {
        void useLicenseStore.getState().init();
    }, []);

    // Re-validate when foregrounded after >1 hour (revoked license check).
    useEffect(() => {
        if (!isInitialized) return;

        let hiddenSince: number | null = null;
        const RECHECK_AFTER_HIDDEN_MS = 60 * 60 * 1000;

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                hiddenSince = Date.now();
            } else if (document.visibilityState === 'visible' && hiddenSince !== null) {
                const hiddenForMs = Date.now() - hiddenSince;
                hiddenSince = null;
                if (hiddenForMs >= RECHECK_AFTER_HIDDEN_MS) void refresh();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isInitialized, refresh]);

    // Release hidden comparison payloads as soon as the user leaves the route.
    // This guards against long-lived route transitions keeping DB-backed
    // columnarData alive in memory after the comparison screen is no longer visible.
    useEffect(() => {
        const prev = previousPathRef.current;
        if (prev === '/dashboard/comparison' && pathname !== '/dashboard/comparison') {
            useComparisonStore.getState().releaseHeavyData();
        }
        // Release module-level analysis cache when navigating away from the
        // Dashboard page.  The cache holds cycles/steps/results by identity —
        // the same objects that React set as component state.  Keeping them
        // rooted at module scope prevents V8 from collecting the unmounted
        // fiber tree's DOM nodes.
        if (prev === '/dashboard' && pathname !== '/dashboard') {
            clearAnalysisCache();
        }
        previousPathRef.current = pathname;
    }, [pathname]);

    return (
        <div className="min-h-screen bg-background">
                {/* Skip to main content — keyboard accessibility */}
                <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-purple-600 focus:text-white focus:rounded-lg focus:font-medium"
                >
                    Перейти к содержимому
                </a>

                {/* Header */}
                <header className="h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 z-50">
                    <div className="w-full px-6 h-full">
                        <div className="flex items-center justify-between h-full">
                            {/* Logo */}
                            <div className="flex items-center gap-3 min-w-[140px] w-auto">
                                <Logo className="w-8 h-8" />
                                <span className="text-lg font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                                    RheoLab
                                </span>
                            </div>

                            {/* Navigation */}
                            <nav className="flex items-center gap-1 bg-muted/50 rounded-full p-1">
                                <NavButton label="Анализ" href="/dashboard" exact automationId="DashboardNavButton" />
                                <NavButton label="Библиотека" href="/dashboard/library" automationId="LibraryNavButton" />
                                <NavButton label="Сравнение" href="/dashboard/comparison" automationId="ComparisonNavButton" />
                                <NavButton label="Настройки" href="/dashboard/settings" automationId="SettingsNavButton" />
                            </nav>

                            {/* Right side actions */}
                            <div className="flex items-center gap-3 min-w-[140px] w-auto justify-end">
                                <LicenseStatusBadge onClick={() => setShowActivation(true)} />
                                <UIModeToggle />
                            </div>
                        </div>
                    </div>
                </header>

                {/* Trial Banner */}
                <Suspense fallback={null}>
                    <TrialBanner onActivate={() => setShowActivation(true)} />
                </Suspense>

                {/* Update Banner */}
                <UpdateBanner />

                {/* Main Content */}
                <main id="main-content" className="min-h-[calc(100vh-64px)]">
                    {children}
                </main>

                {/* License Activation Dialog */}
                <Suspense fallback={null}>
                    <LicenseActivationDialog
                        open={showActivation}
                        onOpenChange={setShowActivation}
                    />
                </Suspense>

                {/* Global Toast Notifications */}
                <ToastContainer />

                {/* Blocking Guard */}
                <LicenseGuard />

                {/* Auto-updater background worker (lazy — polls after 30 s) */}
                <Suspense fallback={null}>
                    <UpdateChecker />
                </Suspense>
            </div>
    );
}

function NavButton({
    label,
    href,
    exact = false,
    automationId,
}: {
    label: string;
    href: string;
    exact?: boolean;
    automationId: string;
}) {
    const { pathname } = useLocation();
    const isActive = exact ? pathname === href : pathname.startsWith(href);

    return (
        <Link
            to={href}
            data-testid={automationId}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${isActive
                ? 'text-foreground bg-secondary'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/80'
                }`}
        >
            {label}
        </Link>
    );
}

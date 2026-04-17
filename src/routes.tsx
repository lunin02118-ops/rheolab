import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout';
import { RouteErrorBoundary } from '@/components/shared/RouteErrorBoundary';

// Pages (lazy-loaded)
import { lazy, Suspense } from 'react';

const RootPage = lazy(() => import('./app/page'));
const DashboardPage = lazy(() => import('./app/dashboard/page'));
const LibraryPage = lazy(() => import('./app/dashboard/library/page'));
const ComparisonPage = lazy(() => import('./app/dashboard/comparison/page'));
const ReportsPage = lazy(() => import('./app/dashboard/reports/page'));
const SettingsPage = lazy(() => import('./app/dashboard/settings/page'));
const ReagentsPage = lazy(() => import('./app/dashboard/reagents/page'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}

export function AppRoutes() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Root page → redirects to dashboard */}
          <Route path="/" element={<RootPage />} />

          {/* Dashboard routes with shared layout */}
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<RouteErrorBoundary name="Главная"><DashboardPage /></RouteErrorBoundary>} />
            <Route path="/dashboard/library" element={<RouteErrorBoundary name="Библиотека"><LibraryPage /></RouteErrorBoundary>} />
            <Route path="/dashboard/comparison" element={<RouteErrorBoundary name="Сравнение"><ComparisonPage /></RouteErrorBoundary>} />
            <Route path="/dashboard/reports" element={<RouteErrorBoundary name="Отчёты"><ReportsPage /></RouteErrorBoundary>} />
            <Route path="/dashboard/settings" element={<RouteErrorBoundary name="Настройки"><SettingsPage /></RouteErrorBoundary>} />
            <Route path="/dashboard/reagents" element={<RouteErrorBoundary name="Реагенты"><ReagentsPage /></RouteErrorBoundary>} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}

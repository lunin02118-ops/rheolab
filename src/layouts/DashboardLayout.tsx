/**
 * Dashboard layout for Vite SPA.
 *
 * Single-user desktop app — no authentication required.
 */

import { Outlet } from 'react-router-dom';
import { DashboardLayoutClient } from '@/app/dashboard/DashboardLayoutClient';

export function DashboardLayout() {
  return (
    <DashboardLayoutClient>
      <Outlet />
    </DashboardLayoutClient>
  );
}

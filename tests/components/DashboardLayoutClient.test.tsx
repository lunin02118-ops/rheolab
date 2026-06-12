// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayoutClient } from '@/app/dashboard/DashboardLayoutClient';

const dashboardLayoutMocks = vi.hoisted(() => ({
    init: vi.fn(),
    refresh: vi.fn(),
    releaseHeavyData: vi.fn(),
}));

vi.mock('@/lib/store/license-store', () => {
    const useLicenseStore = (selector: (state: {
        isInitialized: boolean;
        refresh: () => Promise<void>;
    }) => unknown) => selector({
        isInitialized: true,
        refresh: dashboardLayoutMocks.refresh,
    });
    useLicenseStore.getState = () => ({
        init: dashboardLayoutMocks.init,
    });
    return { useLicenseStore };
});

vi.mock('@/lib/store/comparison-store', () => ({
    useComparisonStore: {
        getState: () => ({
            releaseHeavyData: dashboardLayoutMocks.releaseHeavyData,
        }),
    },
}));

vi.mock('@/components/ui/logo', () => ({
    Logo: () => <div data-testid="MockLogo" />,
}));

vi.mock('@/components/layout/ui-mode-toggle', () => ({
    UIModeToggle: () => <button type="button">Тема</button>,
}));

vi.mock('@/components/licensing/TrialBanner', () => ({
    TrialBanner: ({ onActivate }: { onActivate?: () => void }) => (
        <button type="button" onClick={onActivate}>
            Активировать корпоративную лицензию
        </button>
    ),
}));

vi.mock('@/components/about/AboutProgramDialog', () => ({
    AboutProgramDialog: ({
        open,
        initialTab,
    }: {
        open: boolean;
        initialTab: 'license' | 'updates' | 'contacts';
    }) => open ? <div role="dialog">About dialog: {initialTab}</div> : null,
}));

vi.mock('@/components/shared/UpdateBanner', () => ({
    UpdateBanner: () => null,
}));

vi.mock('@/components/shared/UpdateChecker', () => ({
    UpdateChecker: () => null,
}));

vi.mock('@/components/shared/DatabaseMaintenanceNotice', () => ({
    DatabaseMaintenanceNotice: () => null,
}));

vi.mock('@/components/licensing/LicenseGuard', () => ({
    LicenseGuard: () => null,
}));

function renderLayout() {
    return render(
        <MemoryRouter initialEntries={['/dashboard']}>
            <DashboardLayoutClient>
                <div>Dashboard child</div>
            </DashboardLayoutClient>
        </MemoryRouter>,
    );
}

describe('DashboardLayoutClient about dialog entrypoint', () => {
    beforeEach(() => {
        dashboardLayoutMocks.init.mockReset();
        dashboardLayoutMocks.refresh.mockReset();
        dashboardLayoutMocks.releaseHeavyData.mockReset();
    });

    it('shows About button instead of a visible License header button', async () => {
        renderLayout();

        expect(await screen.findByRole('button', {
            name: 'О программе, поддержка и лицензия',
        })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Лицензия' })).toBeNull();
    });

    it('opens updates tab from the header button', async () => {
        renderLayout();

        fireEvent.click(await screen.findByRole('button', {
            name: 'О программе, поддержка и лицензия',
        }));

        expect((await screen.findByRole('dialog')).textContent).toContain('About dialog: updates');
    });

    it('opens license tab from trial activation CTA', async () => {
        renderLayout();

        fireEvent.click(await screen.findByRole('button', {
            name: 'Активировать корпоративную лицензию',
        }));

        await waitFor(() => {
            expect(screen.getByRole('dialog').textContent).toContain('About dialog: license');
        });
    });
});

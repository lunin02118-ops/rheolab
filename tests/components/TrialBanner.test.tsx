// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrialBanner } from '@/components/licensing/TrialBanner';

const trialBannerMocks = vi.hoisted(() => ({
    useLicense: vi.fn(),
}));

vi.mock('@/hooks/useLicense', () => ({
    useLicense: trialBannerMocks.useLicense,
}));

describe('TrialBanner', () => {
    beforeEach(() => {
        localStorage.clear();
        trialBannerMocks.useLicense.mockReset();
    });

    it('shows the local demo period as a trial banner', () => {
        trialBannerMocks.useLicense.mockReturnValue({
            result: { status: 'demo', source: 'demo' },
            daysRemaining: 30,
            experimentsRemaining: 10,
        });

        render(<TrialBanner />);

        expect(screen.getByText('Пробная версия:')).toBeTruthy();
        expect(screen.getByText(/30 дней осталось/)).toBeTruthy();
        expect(screen.getByText(/10 экспериментов осталось/)).toBeTruthy();
    });

    it('keeps server-issued trial licenses visible too', () => {
        trialBannerMocks.useLicense.mockReturnValue({
            result: {
                status: 'active',
                source: 'key',
                license: { type: 'trial' },
            },
            daysRemaining: 12,
            experimentsRemaining: -1,
        });

        render(<TrialBanner />);

        expect(screen.getByText(/12 дней осталось/)).toBeTruthy();
    });

    it('opens activation when the CTA is clicked', () => {
        const onActivate = vi.fn();
        trialBannerMocks.useLicense.mockReturnValue({
            result: { status: 'demo', source: 'demo' },
            daysRemaining: 5,
            experimentsRemaining: 2,
        });

        render(<TrialBanner onActivate={onActivate} />);
        fireEvent.click(screen.getByRole('button', {
            name: 'Активировать корпоративную лицензию',
        }));

        expect(onActivate).toHaveBeenCalledTimes(1);
    });
});

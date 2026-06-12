// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AboutProgramDialog } from '@/components/about/AboutProgramDialog';

const aboutDialogMocks = vi.hoisted(() => ({
    openUrl: vi.fn(),
    writeText: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: aboutDialogMocks.openUrl,
}));

vi.mock('@/hooks/useLicense', () => ({
    useLicense: () => ({
        result: null,
        activate: vi.fn(),
        activateOffline: vi.fn(),
        createOfflineActivationRequest: vi.fn(),
    }),
}));

vi.mock('@/lib/licensing/tauri-bridge', () => ({
    getServerMachineId: vi.fn().mockResolvedValue('machine-test-id'),
}));

describe('AboutProgramDialog', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        aboutDialogMocks.openUrl.mockReset();
        aboutDialogMocks.openUrl.mockResolvedValue(undefined);
        aboutDialogMocks.writeText.mockReset();
        aboutDialogMocks.writeText.mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: aboutDialogMocks.writeText },
        });
    });

    it('renders license, updates and contacts tabs with updates active by default', () => {
        render(<AboutProgramDialog open onOpenChange={vi.fn()} />);

        expect(screen.getAllByText('О программе').length).toBeGreaterThan(0);
        expect(screen.getByRole('tab', { name: 'Лицензия' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Обновления' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Контакты' })).toBeTruthy();
        expect(screen.getByText('RheoLab Enterprise')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Проверить обновление' })).toBeTruthy();
        expect(screen.getByText('Версия')).toBeTruthy();
        expect(screen.getByText('Канал')).toBeTruthy();
        expect(screen.getByText('Дата сборки')).toBeTruthy();
        expect(screen.getByText('Контрольный хеш')).toBeTruthy();
    });

    it('renders contact info, training links and QR images on contacts tab', () => {
        render(<AboutProgramDialog open onOpenChange={vi.fn()} initialTab="contacts" />);

        expect(screen.getByText('Быстрые действия')).toBeTruthy();
        expect(screen.getByText('QR-коды')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Контакты' })).toBeTruthy();
        const emails = screen.getAllByText(/@rheolab\.site/);
        expect(emails).toHaveLength(1);
        expect(emails[0]?.textContent).toBe('info@rheolab.site');
        expect(screen.getByText('+7 705 803 08 63')).toBeTruthy();
        expect(screen.getByText('+7 982 880 18 22')).toBeTruthy();
        expect(screen.getByText('https://rheolab.site/#videos')).toBeTruthy();
        expect(screen.getByText(/max\.ru\/u\//)).toBeTruthy();
        expect(screen.getByAltText('QR-код MAX для связи с поддержкой RheoLab')).toBeTruthy();
        expect(screen.getByAltText('QR-код раздела обучающих видео RheoLab')).toBeTruthy();
    });

    it('opens training videos through Tauri opener', async () => {
        render(<AboutProgramDialog open onOpenChange={vi.fn()} initialTab="contacts" />);

        fireEvent.click(screen.getByRole('button', { name: 'Обучающие видео' }));

        await waitFor(() => {
            expect(aboutDialogMocks.openUrl).toHaveBeenCalledWith('https://rheolab.site/#videos');
        });
    });

    it('opens contact email through Tauri opener', async () => {
        render(<AboutProgramDialog open onOpenChange={vi.fn()} initialTab="contacts" />);

        fireEvent.click(screen.getByRole('button', { name: 'Написать на info' }));

        await waitFor(() => {
            expect(aboutDialogMocks.openUrl).toHaveBeenCalledWith('mailto:info@rheolab.site');
        });
    });

    it('falls back to clipboard when opener fails', async () => {
        aboutDialogMocks.openUrl.mockRejectedValueOnce(new Error('opener unavailable'));
        render(<AboutProgramDialog open onOpenChange={vi.fn()} initialTab="contacts" />);

        fireEvent.click(screen.getByRole('button', { name: 'Обучающие видео' }));

        await waitFor(() => {
            expect(aboutDialogMocks.writeText).toHaveBeenCalledWith('https://rheolab.site/#videos');
        });
        expect(await screen.findByText('Ссылка на видео скопирована')).toBeTruthy();
    });

    it('shows license activation panel when license tab is initial', async () => {
        render(<AboutProgramDialog open onOpenChange={vi.fn()} initialTab="license" />);

        expect(await screen.findByText('Ключ лицензии')).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Онлайн' })).toBeTruthy();
    });
});

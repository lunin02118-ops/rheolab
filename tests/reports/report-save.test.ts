// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    writeFile: vi.fn(),
    save: vi.fn(),
    open: vi.fn(),
}));

vi.mock('@/lib/tauri', () => ({
    isTauri: () => true,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: mocks.writeFile,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: mocks.save,
    open: mocks.open,
}));

vi.mock('@tauri-apps/api/path', () => ({
    join: async (...parts: string[]) => parts.join('/'),
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

import { saveBytes, saveBytesToDir } from '@/lib/reports/report-save';

describe('report-save E2E direct output mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it('writes bytes directly to the E2E output dir without opening a save dialog', async () => {
        sessionStorage.setItem('__e2e_skip_dialogs', '1');
        sessionStorage.setItem('__e2e_report_output_dir', 'C:\\Temp\\RheoReports');

        const bytes = new Uint8Array([1, 2, 3]);
        await saveBytes({
            bytes,
            filename: 'comparison-report.pdf',
            mimeType: 'application/pdf',
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });

        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.writeFile).toHaveBeenCalledWith('C:\\Temp\\RheoReports\\comparison-report.pdf', bytes);
    });

    it('sanitizes filenames in direct batch writes', async () => {
        sessionStorage.setItem('__e2e_skip_dialogs', '1');
        sessionStorage.setItem('__e2e_report_output_dir', 'C:\\Temp\\RheoReports');

        const pdf = new Uint8Array([1]);
        const xlsx = new Uint8Array([2]);
        await saveBytesToDir([
            { bytes: pdf, filename: '..\\bad.pdf', mimeType: 'application/pdf' },
            { bytes: xlsx, filename: '../bad.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        ]);

        expect(mocks.open).not.toHaveBeenCalled();
        expect(mocks.writeFile).toHaveBeenNthCalledWith(1, 'C:\\Temp\\RheoReports\\.._bad.pdf', pdf);
        expect(mocks.writeFile).toHaveBeenNthCalledWith(2, 'C:\\Temp\\RheoReports\\.._bad.xlsx', xlsx);
    });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RawDataTableById } from '@/components/dashboard/raw-data-table-by-id';
import { getRawTablePageById } from '@/lib/experiments/client';
import type { RawTablePageResponse } from '@/types/tauri';

vi.mock('@/lib/experiments/client', () => ({
    getRawTablePageById: vi.fn(),
}));

const pageResponse = (
    page: number,
    rows: NonNullable<RawTablePageResponse['page']>['rows'],
): RawTablePageResponse => ({
    success: true,
    page: {
        experimentId: 'exp_1',
        totalRows: 4,
        page,
        pageSize: 2,
        totalPages: 2,
        hasBathTemperature: true,
        rows,
    },
});

describe('RawDataTableById', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads only the requested raw table page and pages forward', async () => {
        vi.mocked(getRawTablePageById)
            .mockResolvedValueOnce(pageResponse(1, [
                {
                    index: 1,
                    timeSec: 0,
                    viscosityCp: 100,
                    temperatureC: 25,
                    speedRpm: 300,
                    shearRateS1: 511,
                    shearStressPa: 51,
                    pressureBar: 0,
                    bathTemperatureC: 25,
                },
                {
                    index: 2,
                    timeSec: 60,
                    viscosityCp: 110,
                    temperatureC: 26,
                    speedRpm: 300,
                    shearRateS1: 511,
                    shearStressPa: 52,
                    pressureBar: 1,
                    bathTemperatureC: 26,
                },
            ]))
            .mockResolvedValueOnce(pageResponse(2, [
                {
                    index: 3,
                    timeSec: 120,
                    viscosityCp: 120,
                    temperatureC: 27,
                    speedRpm: 300,
                    shearRateS1: 511,
                    shearStressPa: 53,
                    pressureBar: 2,
                    bathTemperatureC: 27,
                },
            ]));

        render(<RawDataTableById experimentId="exp_1" pageSize={2} />);

        expect(await screen.findByText('0:00')).toBeDefined();
        expect(getRawTablePageById).toHaveBeenCalledWith('exp_1', 1, 2);

        fireEvent.click(screen.getByLabelText('Следующая страница'));

        await waitFor(() => {
            expect(getRawTablePageById).toHaveBeenCalledWith('exp_1', 2, 2);
        });
        expect(await screen.findByText('2:00')).toBeDefined();
    });

    it('shows command errors without falling back to full raw data', async () => {
        vi.mocked(getRawTablePageById).mockResolvedValueOnce({
            success: false,
            error: 'Experiment not found',
        });

        render(<RawDataTableById experimentId="missing" pageSize={2} />);

        expect(await screen.findByText('Experiment not found')).toBeDefined();
    });
});

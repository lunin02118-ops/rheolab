// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Experiment } from '@/types';
import { clearComparisonSelectorCache, ComparisonSelector } from '@/components/comparison/comparison-selector';
import { getExperimentById, listExperiments } from '@/lib/experiments/client';

const experimentsClientMocks = vi.hoisted(() => ({
    listExperiments: vi.fn(),
    getExperimentById: vi.fn(),
}));

vi.mock('@/lib/experiments/client', () => experimentsClientMocks);

vi.mock('@/lib/tauri/core', () => ({
    isTauri: () => true,
}));

vi.mock('@/lib/parsing/client', () => ({
    parseRheologyFile: vi.fn(),
}));

function makeListExperiment(overrides: Partial<Experiment> = {}): Experiment {
    return {
        id: 'exp-1',
        name: 'Saved DB test',
        testDate: '2026-04-30T00:00:00.000Z',
        fluidType: 'Linear',
        instrumentType: 'Grace',
        fieldName: 'Field A',
        operatorName: 'Operator A',
        waterSource: 'Fresh',
        originalFilename: 'saved-db-test.txt',
        createdAt: '2026-04-30T00:00:00.000Z',
        updatedAt: '2026-04-30T00:00:00.000Z',
        rawPoints: [],
        ...overrides,
    } as Experiment;
}

describe('ComparisonSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        clearComparisonSelectorCache();
        vi.mocked(listExperiments).mockResolvedValue({
            experiments: [makeListExperiment()],
            pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
        } as never);
    });

    it('adds saved DB experiments as metadata-only records in binary comparison mode', async () => {
        const onSelect = vi.fn();

        render(<ComparisonSelector isOpen onClose={vi.fn()} onSelect={onSelect} />);

        fireEvent.click(await screen.findByTestId('ComparisonSelectorExperimentButton'));

        await waitFor(() => {
            expect(onSelect).toHaveBeenCalledTimes(1);
        });

        expect(getExperimentById).not.toHaveBeenCalled();
        expect(onSelect.mock.calls[0][0]).toMatchObject({
            id: 'exp-1',
            name: 'Saved DB test',
            rawPoints: [],
            columnarData: undefined,
        });
    });

    it('keeps the legacy full-data load when the comparison store fallback is enabled', async () => {
        window.localStorage.setItem('RHEOLAB_COMPARISON_LEGACY_EXPERIMENT_STORE', '1');
        const fullExperiment = makeListExperiment({
            rawPoints: [{ time_sec: 0, viscosity_cp: 100 }],
        });
        vi.mocked(getExperimentById).mockResolvedValue({
            success: true,
            experiment: fullExperiment,
        } as never);
        const onSelect = vi.fn();

        render(<ComparisonSelector isOpen onClose={vi.fn()} onSelect={onSelect} />);

        fireEvent.click(await screen.findByTestId('ComparisonSelectorExperimentButton'));

        await waitFor(() => {
            expect(getExperimentById).toHaveBeenCalledWith('exp-1');
            expect(onSelect).toHaveBeenCalledWith(fullExperiment);
        });
    });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WaterAnalysisPanel } from '@/components/analysis/water-analysis-panel';

vi.mock('@/lib/water-sources/client', () => ({
    listWaterSources: vi.fn().mockResolvedValue([]),
}));

describe('WaterAnalysisPanel', () => {
    it('renders with initial values', () => {
        render(<WaterAnalysisPanel waterSource="Test Source" />);
        expect(screen.getByDisplayValue('Test Source')).toBeDefined();
    });

    it('calls onWaterSourceChange when input changes', () => {
        const handleChange = vi.fn();
        render(<WaterAnalysisPanel onWaterSourceChange={handleChange} />);

        const input = screen.getByPlaceholderText(/Озеро Самотлор/i);
        fireEvent.change(input, { target: { value: 'New Source' } });

        expect(handleChange).toHaveBeenCalledWith('New Source');
    });

    it('renders params and handles change', () => {
        const handleParamsChange = vi.fn();
        render(
            <WaterAnalysisPanel
                waterParams={{ ph: 7.0 }}
                onParamsChange={handleParamsChange}
            />
        );

        expect(screen.getByDisplayValue('7')).toBeDefined();

        const inputs = screen.getAllByRole('spinbutton');
        if (inputs.length > 0) {
            fireEvent.change(inputs[0], { target: { value: '8.5' } });
            expect(handleParamsChange).toHaveBeenCalled();
        }
    });

    it('loads water sources on mount', async () => {
        const { listWaterSources } = await import('@/lib/water-sources/client');
        render(<WaterAnalysisPanel />);
        await waitFor(() => expect(vi.mocked(listWaterSources)).toHaveBeenCalled());
    });
});


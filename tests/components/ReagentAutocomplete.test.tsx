// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReagentAutocomplete } from '@/components/ui/reagent-autocomplete';

vi.mock('@/lib/reagents/client', () => ({
    listReagents: vi.fn().mockResolvedValue([
        { id: '1', name: 'Reagent A', category: 'Gelling Agent' },
        { id: '2', name: 'Reagent B', category: 'Crosslinker' },
    ]),
}));

describe('ReagentAutocomplete', () => {
    it('renders input', () => {
        render(<ReagentAutocomplete value="" onChange={() => { }} />);
        expect(screen.getByPlaceholderText(/Выберите реагент/i)).toBeDefined();
    });

    it('loads reagents on mount and displays them when opened', async () => {
        render(<ReagentAutocomplete value="" onChange={() => { }} />);

        const input = screen.getByPlaceholderText(/Выберите реагент/i);
        fireEvent.focus(input);

        await waitFor(() => {
            expect(screen.getByText('Reagent A')).toBeDefined();
        });

        // 'Gelling Agent' maps to 'Гелеобразователи'
        expect(screen.getByText('Гелеобразователи')).toBeDefined();
    });

    it('selects a reagent', async () => {
        const handleChange = vi.fn();
        render(<ReagentAutocomplete value="" onChange={handleChange} />);

        const input = screen.getByPlaceholderText(/Выберите реагент/i);
        fireEvent.focus(input);

        await waitFor(() => {
            expect(screen.getByText('Reagent A')).toBeDefined();
        });

        const option = screen.getByText('Reagent A');
        fireEvent.click(option);

        expect(handleChange).toHaveBeenCalled();
    });
});

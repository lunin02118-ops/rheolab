// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecipePanel } from '@/components/analysis/recipe-panel';

vi.mock('@/lib/reagents/client', () => ({
    listReagents: vi.fn().mockResolvedValue([
        { id: '1', name: 'Reagent A', category: 'Biocide' },
        { id: '2', name: 'Reagent B', category: 'Surfactant' }
    ]),
}));

describe('RecipePanel', () => {
    it('renders empty state initially', async () => {
        render(<RecipePanel recipe={[]} />);
        await waitFor(() => expect(screen.getByText(/Нет данных о рецептуре/i)).toBeDefined());
    });

    it('renders recipe rows', async () => {
        const recipe = [{
            abbreviation: 'Test R',
            concentration: 5,
            unit: 'gpt',
            reagentId: '1'
        }];

        render(<RecipePanel recipe={recipe as unknown as Parameters<typeof RecipePanel>[0]['recipe']} />);
        await waitFor(() => expect(screen.getByDisplayValue('5')).toBeDefined());
    });

    it('adds a row when clicking add button', async () => {
        const handleChange = vi.fn();
        render(<RecipePanel recipe={[]} onRecipeChange={handleChange} />);

        await waitFor(() => expect(screen.getByText('Добавить реагент')).toBeDefined());

        const addButton = screen.getByText('Добавить реагент');
        fireEvent.click(addButton);

        expect(handleChange).toHaveBeenCalled();
        const newRecipe = handleChange.mock.calls[0][0];
        expect(newRecipe).toHaveLength(1);
    });

    it('loads reagent catalog on mount', async () => {
        const { listReagents } = await import('@/lib/reagents/client');
        render(<RecipePanel recipe={[]} />);
        await waitFor(() => expect(vi.mocked(listReagents)).toHaveBeenCalled());
    });
});


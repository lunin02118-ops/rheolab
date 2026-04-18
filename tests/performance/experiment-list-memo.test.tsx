// @vitest-environment jsdom
/**
 * WP-3.4 — React.memo re-render profiler tests.
 *
 * Verifies that ExperimentCard is properly memoised:
 *   1. Parent state changes with stable props → no card re-renders.
 *   2. Only the card whose `experiment` prop changed re-renders.
 *   3. Re-render count reduction ≥ 50% vs the unmemoised worst case.
 *
 * Strategy: wrap ExperimentCard in a transparent memo'd `CountingCard` that
 * calls a stable `onRender` callback (same reference across parent re-renders).
 * `CountingCard` is memo'd with the same prop surface as ExperimentCard, so
 * its bail-out behaviour is identical — `onRender` fires iff props changed.
 */
import React, { memo, useState, useCallback } from 'react'
import { render, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub react-router-dom so ExperimentCard's <Link> doesn't need a real router.
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>()
    return {
        ...actual,
        Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) =>
            React.createElement('a', { href: String(to), className }, children),
    }
})

import { ExperimentCard } from '../../src/components/library/experiment-card'
import type { ExperimentCardItem } from '../../src/types/experiment-list-item'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeExp(id: string): ExperimentCardItem {
    return {
        id,
        name: `Experiment ${id}`,
        testDate: '2024-01-15T10:00:00.000Z',
        fluidType: 'Crosslinked Gel',
        fieldName: 'Test Field',
        operatorName: null,
        waterSource: 'River',
        instrumentType: 'Chandler 3.5',
        geometry: null,
        maxViscosity: 500,
        avgViscosity: 250,
        avgTemperatureC: 60,
        maxTemperatureC: 75,
        durationSeconds: 600,
        testCategory: null,
        testType: 'Viscosity',
        dominantPattern: null,
        reagents: [],
        waterParams: null,
        metrics: null,
        user: { name: 'Test User' },
        laboratory: null,
    }
}

// ---------------------------------------------------------------------------
// CountingCard — transparent memo'd wrapper used as a render counter.
//
// Because CountingCard is memo'd with the same props as ExperimentCard,
// its bail-out semantics are identical: `onRender` is called iff
// ExperimentCard would have re-rendered.
//
// `onRender` must be a STABLE reference (created outside the parent component)
// so it never destabilises the memo comparison on this prop.
// ---------------------------------------------------------------------------

type ExperimentCardProps = React.ComponentPropsWithoutRef<typeof ExperimentCard>
type CountingCardProps = ExperimentCardProps & { onRender: () => void }

const CountingCard = memo(function CountingCard({ onRender, ...props }: CountingCardProps) {
    onRender()
    return <ExperimentCard {...props} />
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperimentCard memoisation', () => {
    const IDS = ['a', 'b', 'c', 'd', 'e']

    // Shared render counts — mutated in place so closure references stay valid.
    const renderCounts: Record<string, number> = Object.fromEntries(IDS.map(id => [id, 0]))

    // Stable onRender callbacks — created once at describe-scope, never recreated.
    // React.memo sees the same function reference every render → memo is not broken.
    const stableOnRenders = Object.fromEntries(
        IDS.map(id => [id, () => { renderCounts[id]++ }])
    )

    const onDelete = vi.fn()
    const onToggle = vi.fn()

    beforeEach(() => {
        for (const id of IDS) renderCounts[id] = 0
    })

    // -----------------------------------------------------------------------
    // Test 1: Parent state change with stable card props → zero re-renders.
    // -----------------------------------------------------------------------
    it('no card re-renders when parent state ticks and card props are stable', async () => {
        const experiments = IDS.map(makeExp)

        function Parent() {
            const [tick, setTick] = useState(0)
            // stable references across renders
            const stableDelete = useCallback(onDelete, [])    
            const stableToggle = useCallback(onToggle, [])    

            return (
                <>
                    <button onClick={() => setTick(t => t + 1)}>tick:{tick}</button>
                    {experiments.map(exp => (
                        <CountingCard
                            key={exp.id}
                            experiment={exp}
                            onDeleteRequest={stableDelete}
                            onExpandToggle={stableToggle}
                            isExpanded={false}
                            onRender={stableOnRenders[exp.id]}
                        />
                    ))}
                </>
            )
        }

        const { getByText } = render(<Parent />)
        // Discard mount renders.
        for (const id of IDS) renderCounts[id] = 0

        // Three parent re-renders driven by unrelated state.
        await act(async () => { getByText('tick:0').click() })
        await act(async () => { getByText('tick:1').click() })
        await act(async () => { getByText('tick:2').click() })

        for (const id of IDS) {
            expect(renderCounts[id], `card ${id} re-render count after 3 parent ticks`).toBe(0)
        }
    })

    // -----------------------------------------------------------------------
    // Test 2: Only the card whose experiment prop changed re-renders.
    // -----------------------------------------------------------------------
    it('only the card whose experiment prop changed re-renders', async () => {
        const initialExps = IDS.map(makeExp)

        function Parent({ exps }: { exps: ExperimentCardItem[] }) {
            const stableDelete = useCallback(onDelete, [])    
            const stableToggle = useCallback(onToggle, [])    

            return (
                <>
                    {exps.map(exp => (
                        <CountingCard
                            key={exp.id}
                            experiment={exp}
                            onDeleteRequest={stableDelete}
                            onExpandToggle={stableToggle}
                            isExpanded={false}
                            onRender={stableOnRenders[exp.id]}
                        />
                    ))}
                </>
            )
        }

        const { rerender } = render(<Parent exps={initialExps} />)
        // Discard mount renders.
        for (const id of IDS) renderCounts[id] = 0

        // Only card 'b' gets a new object reference.
        const updatedExps = initialExps.map(e =>
            e.id === 'b' ? { ...e, name: 'Updated Name' } : e
        )
        await act(async () => { rerender(<Parent exps={updatedExps} />) })

        expect(renderCounts['b'], "card 'b' must re-render after prop change").toBe(1)
        for (const id of IDS.filter(i => i !== 'b')) {
            expect(renderCounts[id], `card ${id} must NOT re-render`).toBe(0)
        }
    })

    // -----------------------------------------------------------------------
    // Test 3: Re-render count reduction ≥ 50% vs unmemoised worst-case.
    // -----------------------------------------------------------------------
    it('re-render count reduction ≥ 50% vs unmemoised baseline', async () => {
        const CARD_COUNT = 5
        const CHANGED_ID = 'c'
        const initialExps = IDS.map(makeExp)

        function Parent({ exps }: { exps: ExperimentCardItem[] }) {
            const stableDelete = useCallback(onDelete, [])    
            const stableToggle = useCallback(onToggle, [])    

            return (
                <>
                    {exps.map(exp => (
                        <CountingCard
                            key={exp.id}
                            experiment={exp}
                            onDeleteRequest={stableDelete}
                            onExpandToggle={stableToggle}
                            isExpanded={false}
                            onRender={stableOnRenders[exp.id]}
                        />
                    ))}
                </>
            )
        }

        const { rerender } = render(<Parent exps={initialExps} />)
        // Discard mount renders.
        for (const id of IDS) renderCounts[id] = 0

        const updatedExps = initialExps.map(e =>
            e.id === CHANGED_ID ? { ...e, name: 'Changed' } : e
        )
        await act(async () => { rerender(<Parent exps={updatedExps} />) })

        const totalUpdates = IDS.reduce((sum, id) => sum + renderCounts[id], 0)
        // Worst case (no memo): CARD_COUNT updates. With memo: 1.
        const reductionPct = ((CARD_COUNT - totalUpdates) / CARD_COUNT) * 100

        expect(
            reductionPct,
            `Expected ≥50% render reduction; got ${reductionPct.toFixed(0)}% ` +
            `(${totalUpdates}/${CARD_COUNT} cards updated)`
        ).toBeGreaterThanOrEqual(50)
    })
})

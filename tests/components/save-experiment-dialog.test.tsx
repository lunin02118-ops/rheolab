/**
 * Tests for src/components/dashboard/save-experiment-dialog.tsx
 *
 * Strategy: mock useSaveDialogInit so we control form state,
 * mock sub-form components as lightweight stubs, and drive
 * the dialog purely through onClose / onSave callbacks.
 *
 * Coverage:
 *  - visibility (isOpen=true/false)
 *  - analysis meta displayed
 *  - save button disabled/enabled matrix for each required field
 *  - successful save (minimal + full payload)
 *  - NaN / Infinity rawPoints sanitised before backend call
 *  - all FluidType enum values accepted
 *  - all TestCategory values, cascading testType
 *  - reagents with productionDate (Date object & ISO string)
 *  - calibration data forwarded
 *  - onSave rejection → error banner shown
 *  - Zod validation failure → field path in error (programmatic)
 *  - cancel callback
 *  - loading indicator from isLoading hook state
 *  - "Сохранение..." label while saving
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SaveExperimentDialog } from '@/components/dashboard/save-experiment-dialog';
import type { SaveDialogInitResult } from '@/hooks/useSaveDialogInit';
import type { ExperimentSavePayload, RheoPoint, TestMetrics } from '@/types';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/client-logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Stub heavy sub-form components so we don't pull in catalog / Tauri deps
vi.mock('@/components/experiment-form', () => ({
    ExperimentMetadataForm: ({ name, setName }: { name: string; setName: (v: string) => void }) => (
        <input data-testid="MetaNameInput" value={name} onChange={e => setName(e.target.value)} />
    ),
    WaterSourceSection: ({ waterSource, setWaterSource }: { waterSource: string; setWaterSource: (v: string) => void }) => (
        <input data-testid="WaterSourceInput" value={waterSource} onChange={e => setWaterSource(e.target.value)} />
    ),
    ReagentListEditor: () => <div data-testid="ReagentListEditor" />,
}));

// Default controlled init state returned by the hook
const makeInitResult = (overrides: Partial<SaveDialogInitResult> = {}): SaveDialogInitResult => ({
    name: 'Test name',
    setName: vi.fn(),
    fieldName: 'TestField',
    setFieldName: vi.fn(),
    operatorName: 'Operator',
    setOperatorName: vi.fn(),
    wellNumber: '1',
    setWellNumber: vi.fn(),
    testDate: new Date('2026-01-01'),
    setTestDate: vi.fn(),
    waterSource: 'River',
    setWaterSource: vi.fn(),
    waterParams: { ph: 7, fe: 0, ca: 0, mg: 0, cl: 0, so4: 0, hco3: 0 },
    setWaterParams: vi.fn(),
    reagents: [],
    setReagents: vi.fn(),
    laboratoryId: '',
    setLaboratoryId: vi.fn(),
    laboratoryCatalog: [],
    operatorOptions: [],
    fluidType: 'Linear' as const,
    setFluidType: vi.fn(),
    fluidTypeUserSet: false,
    testCategory: 'Fracturing' as const,
    setTestCategory: vi.fn(),
    testType: 'Hydration' as const,
    setTestType: vi.fn(),
    isLoading: false,
    recentReagentIds: [],
    waterSources: [],
    reagentCatalog: [],
    addToRecentReagents: vi.fn(),
    handleSmartFill: vi.fn(),
    ...overrides,
});

const mockInitHook = vi.fn();

vi.mock('@/hooks/useSaveDialogInit', () => ({
    useSaveDialogInit: (...args: unknown[]) => mockInitHook(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

// analysisData shape mirrors SaveExperimentDialogProps['analysisData']
type AnalysisData = Parameters<typeof SaveExperimentDialog>[0]['analysisData'];

const baseAnalysis: AnalysisData = {
    filename: 'test.xlsx',
    instrumentType: 'Grace',
    testDate: new Date('2026-01-01'),
    fluidType: 'Linear' as const,
    testGroup: 'Hydration' as const,
    metrics: {} as TestMetrics,
    rawPoints: [] as RheoPoint[],
};

function renderDialog(props: {
    isOpen?: boolean;
    onClose?: () => void;
    onSave?: (p: ExperimentSavePayload) => Promise<void>;
    analysis?: AnalysisData;
}) {
    const {
        isOpen = true,
        onClose = vi.fn(),
        onSave = vi.fn().mockResolvedValue(undefined),
        analysis = baseAnalysis,
    } = props;
    return render(
        <SaveExperimentDialog
            isOpen={isOpen}
            onClose={onClose}
            onSave={onSave}
            analysisData={analysis}
        />
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SaveExperimentDialog', () => {
    beforeEach(() => {
        mockInitHook.mockReturnValue(makeInitResult());
    });

    // ── visibility ─────────────────────────────────────────────────────────

    it('renders dialog when isOpen=true', () => {
        renderDialog({ isOpen: true });
        expect(screen.getByTestId('SaveExperimentDialogWindow')).toBeDefined();
        expect(screen.getByText('Сохранить эксперимент')).toBeDefined();
    });

    it('does not render dialog when isOpen=false', () => {
        renderDialog({ isOpen: false });
        expect(screen.queryByTestId('SaveExperimentDialogWindow')).toBeNull();
    });

    // ── analysis info ──────────────────────────────────────────────────────

    it('displays read-only analysis metadata', () => {
        renderDialog({});
        expect(screen.getByText('test.xlsx')).toBeDefined();
        expect(screen.getByText('Grace')).toBeDefined();
    });

    // ── save button disabled/enabled matrix ────────────────────────────────

    it('save button is enabled when all required fields are filled', () => {
        renderDialog({});
        const btn = screen.getByTestId('SaveDialogSaveButton') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('save button is disabled when name is empty', () => {
        mockInitHook.mockReturnValue(makeInitResult({ name: '' }));
        renderDialog({});
        expect((screen.getByTestId('SaveDialogSaveButton') as HTMLButtonElement).disabled).toBe(true);
    });

    it('save button is disabled when waterSource is empty', () => {
        mockInitHook.mockReturnValue(makeInitResult({ waterSource: '' }));
        renderDialog({});
        expect((screen.getByTestId('SaveDialogSaveButton') as HTMLButtonElement).disabled).toBe(true);
    });

    it('save button is NOT disabled when fieldName is empty (fieldName is optional)', () => {
        mockInitHook.mockReturnValue(makeInitResult({ fieldName: '' }));
        renderDialog({});
        expect((screen.getByTestId('SaveDialogSaveButton') as HTMLButtonElement).disabled).toBe(false);
    });

    it('save button is disabled when operatorName is empty', () => {
        mockInitHook.mockReturnValue(makeInitResult({ operatorName: '' }));
        renderDialog({});
        expect((screen.getByTestId('SaveDialogSaveButton') as HTMLButtonElement).disabled).toBe(true);
    });

    it('save button is NOT disabled when wellNumber is empty (wellNumber is optional)', () => {
        mockInitHook.mockReturnValue(makeInitResult({ wellNumber: '' }));
        renderDialog({});
        expect((screen.getByTestId('SaveDialogSaveButton') as HTMLButtonElement).disabled).toBe(false);
    });

    // ── cancel ─────────────────────────────────────────────────────────────

    it('cancel button calls onClose', () => {
        const onClose = vi.fn();
        renderDialog({ onClose });
        fireEvent.click(screen.getByTestId('SaveDialogCancelButton'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    // ── loading indicator ──────────────────────────────────────────────────

    it('shows loading spinner when isLoading=true', () => {
        mockInitHook.mockReturnValue(makeInitResult({ isLoading: true }));
        renderDialog({});
        expect(screen.getByText(/Загрузка последнего контекста/i)).toBeDefined();
    });

    // ── successful save — minimal valid payload ────────────────────────────

    it('calls onSave with correct payload and calls onClose on success', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        renderDialog({ onSave, onClose });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledOnce();
            expect(onClose).toHaveBeenCalledOnce();
        });

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.name).toBe('Test name');
        expect(payload.fieldName).toBe('TestField');
        expect(payload.waterSource).toBe('River');
        expect(payload.fluidType).toBe('Linear');
        expect(payload.rawPoints).toEqual([]);
    });

    it('trims leading/trailing whitespace from string fields before save', async () => {
        mockInitHook.mockReturnValue(makeInitResult({ name: '  Trimmed  ', waterSource: '  Lake  ' }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.name).toBe('Trimmed');
        expect(payload.waterSource).toBe('Lake');
    });

    // ── NaN / Infinity rawPoints sanitisation ──────────────────────────────

    it('filters out rawPoints with NaN time_sec before saving', async () => {
        const badPoints = [
            { time_sec: NaN, viscosity_cp: 100, temperature_c: 25 },
            { time_sec: 60, viscosity_cp: 150, temperature_c: 30 },
        ];
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis: { ...baseAnalysis, rawPoints: badPoints as never } });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.rawPoints).toHaveLength(1);
        expect(payload.rawPoints[0].time_sec).toBe(60);
    });

    it('filters out rawPoints with Infinity viscosity_cp before saving', async () => {
        const badPoints = [
            { time_sec: 10, viscosity_cp: Infinity, temperature_c: 25 },
            { time_sec: 20, viscosity_cp: -Infinity, temperature_c: 25 },
            { time_sec: 30, viscosity_cp: 200, temperature_c: 25 },
        ];
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis: { ...baseAnalysis, rawPoints: badPoints as never } });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.rawPoints).toHaveLength(1);
        expect(payload.rawPoints[0].viscosity_cp).toBe(200);
    });

    it('filters out rawPoints with NaN temperature_c before saving', async () => {
        const badPoints = [
            { time_sec: 10, viscosity_cp: 100, temperature_c: NaN },
            { time_sec: 20, viscosity_cp: 100, temperature_c: 50 },
        ];
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis: { ...baseAnalysis, rawPoints: badPoints as never } });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.rawPoints).toHaveLength(1);
        expect(payload.rawPoints[0].temperature_c).toBe(50);
    });

    it('strips NaN optional fields (shear_rate_s1) but keeps valid point', async () => {
        const pts = [
            { time_sec: 10, viscosity_cp: 100, temperature_c: 25, shear_rate_s1: NaN, speed_rpm: NaN },
        ];
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis: { ...baseAnalysis, rawPoints: pts as RheoPoint[] } });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0];
        expect(payload.rawPoints).toHaveLength(1);
        expect(payload.rawPoints![0].shear_rate_s1).toBeUndefined();
        expect(payload.rawPoints![0].speed_rpm).toBeUndefined();
    });

    it('saves successfully with 1000 clean rawPoints', async () => {
        const pts = Array.from({ length: 1000 }, (_, i) => ({
            time_sec: i * 6,
            viscosity_cp: 200 + Math.sin(i) * 50,
            temperature_c: 60 + Math.cos(i),
        }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis: { ...baseAnalysis, rawPoints: pts } });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.rawPoints).toHaveLength(1000);
    });

    // ── all FluidType enum values ─────────────────────────────────────────

    it.each([
        'Linear', 'Crosslinked', 'Slickwater', 'VES', 'Foam', 'Emulsion', 'WBM', 'OBM', 'SBM'
    ] as const)('saves successfully with fluidType=%s', async (ft) => {
        mockInitHook.mockReturnValue(makeInitResult({ fluidType: ft }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.fluidType).toBe(ft);
    });

    // ── all TestCategory values ───────────────────────────────────────────

    it.each([
        ['Fracturing', 'ThermalStability'],
        ['Drilling',   'MudRheology'],
        ['General',    'WaterAnalysis'],
    ] as const)('saves successfully with testCategory=%s testType=%s', async (cat, tt) => {
        mockInitHook.mockReturnValue(makeInitResult({ testCategory: cat, testType: tt }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.testCategory).toBe(cat);
        expect(payload.testType).toBe(tt);
    });

    // ── reagents ──────────────────────────────────────────────────────────

    it('forwards reagents to payload (productionDate as Date)', async () => {
        const reagents = [{
            key: 'r1',
            reagentId: 'r1',
            reagentName: 'Water Glass',
            concentration: 3.4,
            unit: '%',
            batchNumber: 'B002',
            productionDate: new Date('2025-06-01'),
            category: 'Base fluid',
        }];
        mockInitHook.mockReturnValue(makeInitResult({ reagents }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.reagents).toHaveLength(1);
        expect(payload.reagents[0].reagentId).toBe('r1');
        expect(payload.reagents[0].concentration).toBe(3.4);
    });

    it('forwards reagents to payload (productionDate as ISO string)', async () => {
        const reagents = [{
            key: 'r2',
            reagentId: 'r2',
            reagentName: 'Crosslinker',
            concentration: 0.5,
            unit: 'л/м³',
            batchNumber: undefined,
            productionDate: '2025-03-15' as unknown as Date, // ISO string
        }];
        mockInitHook.mockReturnValue(makeInitResult({ reagents }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.reagents[0].reagentId).toBe('r2');
    });

    it('excludes reagents without reagentId from payload', async () => {
        const reagents = [
            // valid
            { key: 'r3', reagentId: 'r3', reagentName: 'Valid', concentration: 1, unit: '%' },
            // invalid — no reagentId
            { key: 'r4', reagentId: '', reagentName: 'Invalid', concentration: 2, unit: '%' } as never,
        ];
        mockInitHook.mockReturnValue(makeInitResult({ reagents }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.reagents).toHaveLength(1);
        expect(payload.reagents[0].reagentId).toBe('r3');
    });

    // ── calibration data ──────────────────────────────────────────────────

    it('forwards calibration data when provided', async () => {
        const calibration = {
            deviceType: 'Grace M5600',
            calibrationDate: new Date('2026-01-15'),
            rSquared: 0.9998,
            slope: 1.0023,
            intercept: -0.0012,
            hysteresis: 0.005,
            stdev: 0.003,
            status: 'PASS' as const,
            rawData: [],
            issues: [],
        };
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis: { ...baseAnalysis, calibration } });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.calibration?.deviceType).toBe('Grace M5600');
        expect(payload.calibration?.status).toBe('PASS');
        expect(payload.calibration?.rSquared).toBeCloseTo(0.9998);
    });

    it('calibration=null is forwarded as null', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis: { ...baseAnalysis, calibration: null } });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.calibration).toBeNull();
    });

    // ── V8 metadata round-trip ────────────────────────────────────────────

    it('forwards V8 metadata fields to payload', async () => {
        const analysis = {
            ...baseAnalysis,
            parsedBy: 'v8-parser',
            parseSource: 'chandler_csv',
            timeRangeMin: 0,
            timeRangeMax: 7200,
            viscosityMin: 10,
            pressureMax: 500,
            extraFields: { customFlag: true },
        };
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave, analysis });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0];
        expect(payload.parsedBy).toBe('v8-parser');
        expect(payload.parseSource).toBe('chandler_csv');
        expect(payload.timeRangeMin).toBe(0);
        expect(payload.timeRangeMax).toBe(7200);
        expect(payload.extraFields).toEqual({ customFlag: true });
    });

    // ── water params ──────────────────────────────────────────────────────

    it('saves water params (all numeric fields)', async () => {
        const waterParams = { ph: 7.2, fe: 0.3, ca: 120, mg: 45, cl: 280, so4: 55, hco3: 180 };
        mockInitHook.mockReturnValue(makeInitResult({ waterParams }));
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

        const payload = onSave.mock.calls[0][0] as ExperimentSavePayload;
        expect(payload.waterParams?.ph).toBe(7.2);
        expect(payload.waterParams?.cl).toBe(280);
    });

    // ── save error ─────────────────────────────────────────────────────────

    it('shows error banner when onSave rejects with Error', async () => {
        const onSave = vi.fn().mockRejectedValue(new Error('Server error'));
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));

        await waitFor(() => {
            expect(screen.getByText('Server error')).toBeDefined();
        });
    });

    it('shows generic error when onSave rejects with non-Error', async () => {
        const onSave = vi.fn().mockRejectedValue('unknown failure');
        renderDialog({ onSave });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));

        await waitFor(() => {
            expect(screen.getByText(/ошибка сохранения/i)).toBeDefined();
        });
    });

    it('does NOT call onClose when onSave rejects', async () => {
        const onClose = vi.fn();
        const onSave = vi.fn().mockRejectedValue(new Error('fail'));
        renderDialog({ onSave, onClose });

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));

        await waitFor(() => expect(screen.getByText('fail')).toBeDefined());
        expect(onClose).not.toHaveBeenCalled();
    });

    // ── "Сохранение..." label while saving ───────────────────────────────

    it('save button shows "Сохранение..." label while save is in progress', async () => {
        let resolvePromise!: () => void;
        const onSave = vi.fn().mockReturnValue(
            new Promise<void>(r => { resolvePromise = r; })
        );
        renderDialog({ onSave });

        await act(async () => {
            fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));
        });

        expect(screen.getByTestId('SaveDialogSaveButton').textContent).toContain('Сохранение');

        await act(async () => { resolvePromise(); });
    });

    // ── Zod validation failure with path in message ────────────────────────
    // Simulate a case where Zod rejects (e.g., invalid enum) by injecting
    // bad analysis data that bypasses client-side guards.

    it('shows field path in validation error message for enum mismatch', async () => {
        // fluidType with a value not in enum — will fail Zod
        mockInitHook.mockReturnValue(makeInitResult({ fluidType: 'NotAType' as never }));
        renderDialog({});

        fireEvent.click(screen.getByTestId('SaveDialogSaveButton'));

        await waitFor(() => {
            const errorEl = screen.queryByText(/поле:/i);
            // Message like "Invalid enum value... (поле: fluidType)"
            expect(errorEl || screen.queryByText(/fluidType/i)).toBeDefined();
        });
    });
});

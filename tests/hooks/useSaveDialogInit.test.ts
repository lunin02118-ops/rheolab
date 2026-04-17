// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ReactDOMClient from 'react-dom/client';

// ── Custom renderHook without act() ─────────────────────────────────────────
// @testing-library/react's renderHook wraps the initial render in act().
// With this hook's 9 interleaved async effects, act() enters an infinite
// microtask-flush loop that OOMs the worker. This version renders without act()
// and relies on settle() to let effects complete.

const settle = () => new Promise<void>(r => setTimeout(r, 50));

let _root: ReturnType<typeof ReactDOMClient.createRoot> | null = null;
let _container: HTMLDivElement | null = null;

function renderHookDirect<T>(hookFn: () => T) {
  const resultRef = { current: undefined as unknown as T };
  function TestComponent() {
    resultRef.current = hookFn();
    return null;
  }
  _container = document.createElement('div');
  document.body.appendChild(_container);
  _root = ReactDOMClient.createRoot(_container);
  _root.render(React.createElement(TestComponent));
  return { result: resultRef };
}

interface RerenderHookResult<T, P extends Record<string, unknown> = Record<string, unknown>> {
  result: { current: T };
  rerender: (props: P) => void;
}

function renderHookWithProps<T, P extends Record<string, unknown>>(
  hookFn: (props: P) => T,
  options: { initialProps: P },
): RerenderHookResult<T, P> {
  const resultRef = { current: undefined as unknown as T };
  let currentProps: P = options.initialProps;
  function TestComponent() {
    resultRef.current = hookFn(currentProps);
    return null;
  }
  _container = document.createElement('div');
  document.body.appendChild(_container);
  _root = ReactDOMClient.createRoot(_container);
  _root.render(React.createElement(TestComponent));
  return {
    result: resultRef,
    rerender: (props: P) => {
      currentProps = props;
      _root!.render(React.createElement(TestComponent));
    },
  };
}

// ── Mocks ───────────────────────────────────────────────────────────────────

const { mockParseFilename, mockGetLastContext, mockDetectFluidType, mockDetectTestCat } = vi.hoisted(() => ({
  mockParseFilename: vi.fn().mockReturnValue({}),
  mockGetLastContext: vi.fn().mockResolvedValue(null),
  mockDetectFluidType: vi.fn().mockReturnValue('Linear'),
  mockDetectTestCat: vi.fn().mockReturnValue({ testCategory: 'Fracturing', testType: 'ShearViscosity' }),
}));

vi.mock('@/lib/utils/smart-fill-utils', () => ({
  parseExperimentFilename: mockParseFilename,
}));

vi.mock('@/lib/experiments/client', () => ({
  getLastExperimentContext: mockGetLastContext,
}));

vi.mock('@/lib/utils/fluid-type-detector', () => ({
  detectFluidType: mockDetectFluidType,
}));

vi.mock('@/lib/utils/test-type-detector', () => ({
  detectTestCategoryAndType: mockDetectTestCat,
}));

// Catalog store mock
const mockFetchReagents = vi.fn();
const mockFetchWaterSources = vi.fn();
const stableReagents: unknown[] = [];
const stableWaterSources: string[] = ['Tap', 'Well'];

vi.mock('@/lib/store/catalog-store', () => ({
  useCatalogStore: (selector: (s: Record<string, unknown>) => unknown) => selector({
    reagents: stableReagents,
    waterSources: stableWaterSources,
    fetchReagents: mockFetchReagents,
    fetchWaterSources: mockFetchWaterSources,
  }),
}));

// Bridge mock
const mockOperatorsList = vi.fn().mockResolvedValue([]);
const mockLaboratoriesList = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: () => ({
    operators: { list: mockOperatorsList },
    laboratories: { list: mockLaboratoriesList },
  }),
}));

import { useSaveDialogInit } from '@/hooks/useSaveDialogInit';
import type { SaveDialogInitData } from '@/hooks/useSaveDialogInit';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeData(overrides: Partial<SaveDialogInitData> = {}): SaveDialogInitData {
  return {
    filename: 'Test_Fluid_2025.csv',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useSaveDialogInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetLastContext.mockResolvedValue(null);
    mockParseFilename.mockReturnValue({});
    mockDetectFluidType.mockReturnValue('Linear');
    mockDetectTestCat.mockReturnValue({ testCategory: 'Fracturing', testType: 'ShearViscosity' });
  });

  afterEach(() => {
    if (_root) { _root.unmount(); _root = null; }
    if (_container) { _container.remove(); _container = null; }
    localStorage.clear();
  });

  // ── Initialization ───────────────────────────────────────────────────────

  describe('initialization', () => {
    it('returns default form state when closed', async () => {
      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(false, data));

      await settle();

      expect(result.current.name).toBe('');
      expect(result.current.fieldName).toBe('');
      expect(result.current.operatorName).toBe('');
      expect(result.current.wellNumber).toBe('');
      expect(result.current.waterSource).toBe('');
      expect(result.current.reagents).toEqual([]);
      expect(result.current.fluidType).toBe('Linear');
      expect(result.current.fluidTypeUserSet).toBe(false);
    });

    it('sets name from filename (without extension) when opened', async () => {
      const data = makeData({ filename: 'MyExperiment.xlsx' });
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.name).toBe('MyExperiment');
    });

    it('fetches catalog on mount', async () => {
      const data = makeData();
      renderHookDirect(() => useSaveDialogInit(false, data));

      await settle();

      expect(mockFetchReagents).toHaveBeenCalled();
      expect(mockFetchWaterSources).toHaveBeenCalled();
    });

    it('exposes waterSources from catalog store', async () => {
      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.waterSources).toEqual(['Tap', 'Well']);
    });
  });

  // ── Operators & Laboratories (Effect 0) ──────────────────────────────────

  describe('operators and laboratories', () => {
    it('loads operators and laboratories when dialog opens', async () => {
      mockOperatorsList.mockResolvedValue([{ id: '1', name: 'John' }]);
      mockLaboratoriesList.mockResolvedValue([{ id: 'lab1', name: 'Lab A' }]);

      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.operatorOptions).toEqual(['John']);
      expect(result.current.laboratoryCatalog).toEqual([{ id: 'lab1', name: 'Lab A' }]);
    });

    it('handles bridge failure gracefully', async () => {
      mockOperatorsList.mockRejectedValue(new Error('fail'));
      mockLaboratoriesList.mockRejectedValue(new Error('fail'));

      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.operatorOptions).toEqual([]);
      expect(result.current.laboratoryCatalog).toEqual([]);
    });
  });

  // ── Smart Fill (Effect 3) ────────────────────────────────────────────────

  describe('smart fill from last context', () => {
    it('fills fieldName and operatorName from last context', async () => {
      mockGetLastContext.mockResolvedValue({
        fieldName: 'OilField-1',
        operatorName: 'Jane',
      });

      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.fieldName).toBe('OilField-1');
      expect(result.current.operatorName).toBe('Jane');
    });

    it('does not override prefilled fields with context', async () => {
      mockGetLastContext.mockResolvedValue({
        fieldName: 'OilField-1',
        operatorName: 'Jane',
      });

      const data = makeData({
        prefilledFieldName: 'DashboardField',
        prefilledOperatorName: 'Bob',
      });
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.fieldName).toBe('DashboardField');
      expect(result.current.operatorName).toBe('Bob');
    });
  });

  // ── Filename Parsing (Effect 4) ──────────────────────────────────────────

  describe('filename metadata parsing', () => {
    it('calls parseExperimentFilename when opened', async () => {
      mockParseFilename.mockReturnValue({
        fieldName: 'ParsedField',
        wellNumber: '42',
      });

      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(mockParseFilename).toHaveBeenCalledWith('Test_Fluid_2025.csv');
      expect(result.current.fieldName).toBe('ParsedField');
      expect(result.current.wellNumber).toBe('42');
    });
  });

  // ── Prefill from Dashboard (Effect 5) ────────────────────────────────────

  describe('prefill from dashboard', () => {
    it('prefills all provided fields', async () => {
      const data = makeData({
        prefilledName: 'Custom Name',
        prefilledFieldName: 'Field X',
        prefilledOperatorName: 'Operator Y',
        prefilledWellNumber: 'W-999',
        prefilledWaterSource: 'Well',
        prefilledWaterParams: { ph: 7.2, fe: 0.5 },
      });
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.name).toBe('Custom Name');
      expect(result.current.fieldName).toBe('Field X');
      expect(result.current.operatorName).toBe('Operator Y');
      expect(result.current.wellNumber).toBe('W-999');
      expect(result.current.waterSource).toBe('Well');
      expect(result.current.waterParams.ph).toBe(7.2);
      expect(result.current.waterParams.fe).toBe(0.5);
    });

    it('prefills recipe rows', async () => {
      const data = makeData({
        prefilledRecipe: [
          { abbreviation: 'HEC', concentration: 5.0, unit: 'kg/m3' },
        ],
      });
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();

      expect(result.current.reagents).toHaveLength(1);
      expect(result.current.reagents[0].reagentName).toBe('HEC');
      expect(result.current.reagents[0].concentration).toBe(5.0);
    });
  });

  // ── Reset on Close (Effect 6) ────────────────────────────────────────────

  describe('reset on close', () => {
    it('clears all form state when dialog closes', async () => {
      const data = makeData({ prefilledName: 'Filled' });
      const { result, rerender } = renderHookWithProps(
        ({ isOpen }: { isOpen: boolean }) => useSaveDialogInit(isOpen, data),
        { initialProps: { isOpen: true } },
      );

      await settle();
      expect(result.current.name).toBe('Filled');

      rerender({ isOpen: false });
      await settle();

      expect(result.current.name).toBe('');
      expect(result.current.fieldName).toBe('');
      expect(result.current.waterSource).toBe('');
      expect(result.current.reagents).toEqual([]);
      expect(result.current.fluidTypeUserSet).toBe(false);
    });
  });

  // ── FluidType Detection (Effect 7) ──────────────────────────────────────

  describe('fluid type detection', () => {
    it('does not auto-detect when user has set fluidType manually', async () => {
      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();
      result.current.setFluidType('Crosslinked');
      await settle();

      expect(result.current.fluidType).toBe('Crosslinked');
      expect(result.current.fluidTypeUserSet).toBe(true);
    });
  });

  // ── Recent Reagents ─────────────────────────────────────────────────────

  describe('recent reagents', () => {
    it('persists to localStorage', async () => {
      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();
      result.current.addToRecentReagents('r1');
      await settle();
      result.current.addToRecentReagents('r2');
      await settle();

      expect(result.current.recentReagentIds).toEqual(['r2', 'r1']);
      const stored = JSON.parse(localStorage.getItem('rheolab-recent-reagents') ?? '[]');
      expect(stored).toEqual(['r2', 'r1']);
    });

    it('keeps max 3 recent reagents', async () => {
      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();
      result.current.addToRecentReagents('r1');
      await settle();
      result.current.addToRecentReagents('r2');
      await settle();
      result.current.addToRecentReagents('r3');
      await settle();
      result.current.addToRecentReagents('r4');
      await settle();

      expect(result.current.recentReagentIds).toHaveLength(3);
      expect(result.current.recentReagentIds[0]).toBe('r4');
    });

    it('deduplicates reagent IDs', async () => {
      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();
      result.current.addToRecentReagents('r1');
      await settle();
      result.current.addToRecentReagents('r2');
      await settle();
      result.current.addToRecentReagents('r1'); // duplicate → moves to front
      await settle();

      expect(result.current.recentReagentIds).toEqual(['r1', 'r2']);
    });

    it('loads from localStorage on mount', async () => {
      localStorage.setItem('rheolab-recent-reagents', JSON.stringify(['rA', 'rB']));

      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(false, data));

      await settle();

      expect(result.current.recentReagentIds).toEqual(['rA', 'rB']);
    });
  });

  // ── handleSmartFill ──────────────────────────────────────────────────────

  describe('handleSmartFill', () => {
    it('parses filename and applies metadata', async () => {
      mockParseFilename.mockReturnValue({
        fieldName: 'SmartField',
        wellNumber: '7',
        operatorName: 'SmartOp',
      });

      const data = makeData();
      const { result } = renderHookDirect(() => useSaveDialogInit(true, data));

      await settle();
      result.current.handleSmartFill();
      await settle();

      expect(result.current.fieldName).toBe('SmartField');
      expect(result.current.wellNumber).toBe('7');
      expect(result.current.operatorName).toBe('SmartOp');
    });
  });
});

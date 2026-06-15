import { useMemo } from 'react';
import type { ExperimentFilters as FilterState } from '@/types/experiment-filters';
import { EMPTY_FILTERS } from '@/types/experiment-filters';
import { Filter, X, Ruler, Waypoints, Search as SearchIcon, MapPin, FlaskConical, CalendarDays, Beaker } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ReagentAutocomplete } from '@/components/ui/reagent-autocomplete';
import { FieldCombobox } from '@/components/ui/field-combobox';
import { TextFilter, SelectFilter, RangeFilter } from './filter-components';
import { FilterGroup } from './filter-group';
import { ViscosityThresholdSelector } from './viscosity-threshold-selector';
import { FLUID_TYPES, FLUID_TYPE_LABELS } from '@/lib/constants/fluid-types';
import { TEST_CATEGORY_LABELS, TEST_TYPE_LABELS, TEST_TYPES_BY_CATEGORY, type TestCategory, type TestType } from '@/lib/constants/test-types';
import { useExperimentFilterMetadata } from '@/hooks/useExperimentFilterMetadata';
import {
    crossingCoverageHint,
    crossingTimeHint,
    viscosityAtTargetHint,
} from '@/lib/library/touch-point-hints';
import type { TouchPointLibraryStats } from '@/types/tauri';

interface ExperimentFiltersProps {
    filters: FilterState;
    onChange: (filters: FilterState) => void;
}

interface TouchPointFilterHints {
    hasCrossing: string | null;
    crossingTime: string | null;
    viscosityAtTarget: string | null;
}

const EMPTY_STRING_LIST: string[] = [];

const FLUID_TYPE_OPTIONS = [
    { value: '', label: 'Все типы' },
    ...FLUID_TYPES.map(ft => ({ value: ft, label: FLUID_TYPE_LABELS[ft] })),
];

const INSTRUMENT_OPTIONS = [
    { value: '', label: 'Все приборы' },
    { value: 'Grace M5600', label: 'Grace M5600' },
    { value: 'Chandler 5550', label: 'Chandler 5550' },
    { value: 'BSL R1', label: 'BSL R1' },
    { value: 'Fann 50', label: 'Fann 50' },
    { value: 'Brookfield PVS', label: 'Brookfield PVS' },
    { value: 'Ofite 1100', label: 'Ofite 1100' },
];

const GEOMETRY_OPTIONS = [
    { value: '', label: 'Все геометрии' },
    { value: 'R1B1', label: 'R1B1' },
    { value: 'R1B2', label: 'R1B2' },
    { value: 'R1B5', label: 'R1B5' },
];

function buildTouchPointFilterHints(stats: TouchPointLibraryStats | null): TouchPointFilterHints {
    return {
        hasCrossing: crossingCoverageHint(stats),
        crossingTime: crossingTimeHint(stats),
        viscosityAtTarget: viscosityAtTargetHint(stats),
    };
}

function thresholdLabel(value: string): string {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(parsed) && parsed > 0) {
        return `${trimmed} сП`;
    }
    return '50 сП';
}

function activeValue(value: string): number {
    return value ? 1 : 0;
}

function hasAnyActiveFilter(filters: FilterState): boolean {
    return filters.searchQuery !== ''
        || filters.testName !== ''
        || filters.laboratoryName !== ''
        || filters.fieldName !== ''
        || filters.operatorName !== ''
        || filters.wellNumber !== ''
        || filters.waterSource !== ''
        || filters.fluidType !== ''
        || filters.instrumentType !== ''
        || filters.geometry !== ''
        || filters.testCategory !== ''
        || filters.testType !== ''
        || filters.batchNumber !== ''
        || filters.reagentNames.length > 0
        || filters.dateFrom !== ''
        || filters.dateTo !== ''
        || filters.durationMin !== ''
        || filters.durationMax !== ''
        || filters.tempMin !== ''
        || filters.tempMax !== ''
        || filters.viscosityMin !== ''
        || filters.viscosityMax !== ''
        || filters.viscosityThreshold !== ''
        || filters.crossingTimeMin !== ''
        || filters.crossingTimeMax !== ''
        || filters.viscosityAtTargetMin !== ''
        || filters.viscosityAtTargetMax !== ''
        || filters.hasCrossing !== '';
}

export function ExperimentFilters({ filters, onChange }: ExperimentFiltersProps) {
    // Shared module-level cache — both this panel and the ExperimentList
    // empty state derive hints from the same metadata payload, so we only
    // round-trip to Rust once per session (plus the backend's 30s TTL).
    const { metadata, error: metadataError } = useExperimentFilterMetadata();

    const instrumentTypes = metadata?.instrumentTypes ?? EMPTY_STRING_LIST;
    const fluidTypes = metadata?.fluidTypes ?? EMPTY_STRING_LIST;
    const geometries = metadata?.geometries ?? EMPTY_STRING_LIST;
    const waterSources = metadata?.waterSources ?? EMPTY_STRING_LIST;
    const fieldNames = metadata?.fieldNames ?? EMPTY_STRING_LIST;
    const testCategories = metadata?.testCategories ?? EMPTY_STRING_LIST;
    const testTypes = metadata?.testTypes ?? EMPTY_STRING_LIST;

    // Touch-point hints — precomputed lazily so the touch-point sidebar
    // section renders with captions as soon as the metadata fetch resolves.
    const touchPointStats = metadata?.touchPointStats ?? null;
    const touchPointHints = useMemo(
        () => buildTouchPointFilterHints(touchPointStats),
        [touchPointStats],
    );

    // "Достигнут порог X сП" label — reflects whichever threshold the
    // user has dialled in (or the default 50 cP) so the selector's
    // question stays honest about what crossing is being tested.
    const thresholdLabelText = thresholdLabel(filters.viscosityThreshold);

    const fluidOptions = useMemo(() => {
        if (fluidTypes.length === 0) {
            return FLUID_TYPE_OPTIONS;
        }

        return [
            { value: '', label: 'Все типы' },
            ...fluidTypes.map((value) => ({
                value,
                label: FLUID_TYPE_LABELS[value as keyof typeof FLUID_TYPE_LABELS] ?? value,
            })),
        ];
    }, [fluidTypes]);

    const instrumentOptions = useMemo(() => {
        if (instrumentTypes.length === 0) {
            return INSTRUMENT_OPTIONS;
        }

        return [
            { value: '', label: 'Все приборы' },
            ...instrumentTypes.map((value) => ({
                value,
                label: value,
            })),
        ];
    }, [instrumentTypes]);

    const geometryOptions = useMemo(() => {
        if (geometries.length === 0) {
            return GEOMETRY_OPTIONS;
        }

        return [
            { value: '', label: 'Все геометрии' },
            ...geometries.map((value) => ({
                value,
                label: value,
            })),
        ];
    }, [geometries]);

    const testCategoryOptions = useMemo(() => {
        const cats = testCategories.length > 0 ? testCategories : EMPTY_STRING_LIST;
        return [
            { value: '', label: 'Все категории' },
            ...cats.map(c => ({
                value: c,
                label: TEST_CATEGORY_LABELS[c as TestCategory] ?? c,
            })),
        ];
    }, [testCategories]);

    const testTypeOptions = useMemo(() => {
        // If a category is selected, show only its test types; otherwise show all from metadata
        let types: readonly string[];
        if (filters.testCategory) {
            const byCategory = TEST_TYPES_BY_CATEGORY[filters.testCategory as TestCategory];
            types = byCategory ?? EMPTY_STRING_LIST;
        } else {
            types = testTypes.length > 0 ? testTypes : EMPTY_STRING_LIST;
        }
        return [
            { value: '', label: 'Все типы испытаний' },
            ...types.map(t => ({
                value: t,
                label: TEST_TYPE_LABELS[t as TestType] ?? t,
            })),
        ];
    }, [testTypes, filters.testCategory]);

    const handleChange = (key: keyof FilterState, value: string) => {
        onChange({ ...filters, [key]: value });
    };

    // `hasCrossing` is stored as the literal union `'' | 'yes' | 'no'` for
    // backend compatibility (the IPC contract and E2E tests still exercise
    // the 'no' branch directly).  The sidebar surfaces only the binary
    // toggle — OFF (`''`, default) and ON (`'yes'`) — because the inverse
    // case ("only experiments that did NOT cross") has no documented user
    // workflow and the three-state selector was reported as confusing.
    const isHasCrossingOn = filters.hasCrossing === 'yes';
    const toggleHasCrossing = () => {
        onChange({
            ...filters,
            hasCrossing: isHasCrossingOn ? '' : 'yes',
        });
    };

    // `viscosityThreshold === ''` is the "filter OFF" sentinel: when the
    // user clicks the "выкл" pill we MUST also clear all downstream
    // touch-point subfilters.  Otherwise the UI would claim the filter
    // is off while the backend still received a `hasCrossing`/range
    // value from a prior session and quietly kept filtering under the
    // default 50 cP contract.  Switching to an actual threshold is
    // non-destructive — existing `hasCrossing` / range values carry
    // over so users can iterate on the threshold without retyping.
    const handleThresholdChange = (value: string) => {
        if (value.trim() === '') {
            onChange({
                ...filters,
                viscosityThreshold: '',
                hasCrossing: '',
                crossingTimeMin: '',
                crossingTimeMax: '',
                viscosityAtTargetMin: '',
                viscosityAtTargetMax: '',
            });
            return;
        }
        // Auto-activate `hasCrossing = 'yes'` when switching from OFF to a
        // concrete threshold.  Without this the user sees ALL experiments
        // (no WHERE on tpp.hasCrossing) — which looks like "wrong results"
        // because experiments that never crossed the threshold still appear.
        // The auto-set only fires when hasCrossing was previously empty
        // (the user hasn't actively chosen 'no'), so manual toggling is
        // preserved on threshold-to-threshold changes.
        const wasOff = filters.viscosityThreshold.trim() === '';
        const autoHasCrossing =
            wasOff && filters.hasCrossing === '' ? 'yes' : filters.hasCrossing;
        onChange({ ...filters, viscosityThreshold: value, hasCrossing: autoHasCrossing });
    };

    // Mirror of the selector's OFF sentinel — used to collapse the
    // downstream touch-point controls (toggle + ranges + hints) when
    // the filter is disabled.  Keeps the sidebar quiet in the common
    // case where the user doesn't care about crossing.
    const isTouchPointFilterActive = filters.viscosityThreshold.trim() !== '';

    const clearFilters = () => {
        onChange({ ...EMPTY_FILTERS });
    };

    const hasActiveFilters = hasAnyActiveFilter(filters);

    const addReagent = (name: string) => {
        if (name && !filters.reagentNames.includes(name)) {
            onChange({ ...filters, reagentNames: [...filters.reagentNames, name] });
        }
    };

    const removeReagent = (name: string) => {
        onChange({ ...filters, reagentNames: filters.reagentNames.filter(r => r !== name) });
    };

    // ── Active-filter counts per group (drives badge numbers) ──────
    const searchCount = activeValue(filters.searchQuery)
        + activeValue(filters.testName);
    const locationCount = activeValue(filters.laboratoryName)
        + activeValue(filters.fieldName)
        + activeValue(filters.wellNumber)
        + activeValue(filters.waterSource)
        + activeValue(filters.dateFrom)
        + activeValue(filters.dateTo);
    const testParamsCount = activeValue(filters.fluidType)
        + activeValue(filters.instrumentType)
        + activeValue(filters.geometry)
        + activeValue(filters.testCategory)
        + activeValue(filters.testType)
        + activeValue(filters.operatorName);
    const rangeCount = activeValue(filters.durationMin)
        + activeValue(filters.durationMax)
        + activeValue(filters.tempMin)
        + activeValue(filters.tempMax)
        + activeValue(filters.viscosityMin)
        + activeValue(filters.viscosityMax)
        + activeValue(filters.viscosityThreshold)
        + activeValue(filters.hasCrossing)
        + activeValue(filters.crossingTimeMin)
        + activeValue(filters.crossingTimeMax)
        + activeValue(filters.viscosityAtTargetMin)
        + activeValue(filters.viscosityAtTargetMax);
    const qaCount = activeValue(filters.batchNumber)
        + filters.reagentNames.length;

    return (
        <div data-testid="ExperimentFiltersPanel" className="bg-secondary/50 rounded-xl border border-border p-3 lg:sticky lg:top-24 overflow-visible">
            {metadataError && (
                <div className="mb-3 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-center gap-1.5">
                    <span>⚠</span> {metadataError}
                </div>
            )}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-foreground font-medium">
                    <Filter className="w-4 h-4 text-blue-400" />
                    Фильтры
                </div>
                <button
                    onClick={clearFilters}
                    disabled={!hasActiveFilters}
                    data-testid="ClearFiltersButton"
                    className={`text-xs flex items-center gap-1 transition-colors ${hasActiveFilters
                        ? 'text-muted-foreground hover:text-foreground cursor-pointer'
                        : 'text-muted-foreground cursor-not-allowed'}`}
                >
                    <X className="w-3 h-3" />
                    Сбросить
                </button>
            </div>

            {/* ── 1. Поиск ─────────────────────────────────────── */}
            {/* All five groups start collapsed on mount so first paint stays
                quiet; the activeCount badge keeps any pre-loaded filters
                visible without popping the group open. */}
            <FilterGroup
                title="Поиск"
                icon={<SearchIcon className="w-3.5 h-3.5" />}
                activeCount={searchCount}
            >
                <TextFilter label="Общий поиск" value={filters.searchQuery}
                    onChange={v => handleChange('searchQuery', v)} placeholder="Имя, файл, реагент..." showSearch testId="ExperimentSearchInput" />
                <TextFilter label="Название теста" value={filters.testName}
                    onChange={v => handleChange('testName', v)} placeholder="Название эксперимента..." testId="ExperimentNameFilterInput" />
            </FilterGroup>

            {/* ── 2. Локация и объект ──────────────────────────── */}
            <FilterGroup
                title="Локация и объект"
                icon={<MapPin className="w-3.5 h-3.5" />}
                activeCount={locationCount}
            >
                <RangeFilter label="Дата теста" minValue={filters.dateFrom} maxValue={filters.dateTo}
                    onMinChange={v => handleChange('dateFrom', v)} onMaxChange={v => handleChange('dateTo', v)} type="date"
                    minTestId="DateFromFilterInput" maxTestId="DateToFilterInput" />

                <TextFilter label="Лаборатория" value={filters.laboratoryName}
                    onChange={v => handleChange('laboratoryName', v)} placeholder="Название лаб..." testId="ExperimentLaboratoryFilterInput" />

                <div className="space-y-2">
                    <label className="text-xs text-muted-foreground block">Месторождение</label>
                    <FieldCombobox
                        value={filters.fieldName}
                        onChange={v => handleChange('fieldName', v)}
                        extraSuggestions={fieldNames}
                        testId="ExperimentFieldFilterInput"
                        inputClassName="bg-card border-border text-foreground focus-visible:ring-blue-500"
                        placeholder="Поиск..."
                    />
                </div>

                <TextFilter label="Скважина / Куст" value={filters.wellNumber}
                    onChange={v => handleChange('wellNumber', v)} placeholder="Номер скважины..." testId="ExperimentWellFilterInput" />

                <TextFilter label="Источник воды" value={filters.waterSource}
                    onChange={v => handleChange('waterSource', v)}
                    placeholder={waterSources.length > 0
                        ? `Например: ${waterSources[0]}`
                        : 'Источник воды...'}
                    testId="ExperimentWaterFilterInput"
                />
            </FilterGroup>

            {/* ── 3. Параметры теста ──────────────────────────── */}
            <FilterGroup
                title="Параметры теста"
                icon={<FlaskConical className="w-3.5 h-3.5" />}
                activeCount={testParamsCount}
            >
                <TextFilter label="Оператор" value={filters.operatorName}
                    onChange={v => handleChange('operatorName', v)} placeholder="Фамилия..." testId="ExperimentOperatorFilterInput" />

                <SelectFilter label="Тип жидкости" value={filters.fluidType}
                    onChange={v => handleChange('fluidType', v)} options={fluidOptions} testId="FluidTypeFilterSelect" />

                <SelectFilter label="Прибор" value={filters.instrumentType}
                    onChange={v => handleChange('instrumentType', v)} options={instrumentOptions} testId="InstrumentTypeFilterSelect" />

                <SelectFilter
                    label="Геометрия"
                    value={filters.geometry}
                    onChange={v => handleChange('geometry', v)}
                    options={geometryOptions}
                    icon={<Ruler className="w-3 h-3 text-emerald-400" />}
                    borderColor="emerald"
                />

                <SelectFilter
                    label="Категория теста"
                    value={filters.testCategory}
                    onChange={v => {
                        const newFilters = { ...filters, testCategory: v };
                        if (v && filters.testType) {
                            const byCategory = TEST_TYPES_BY_CATEGORY[v as TestCategory];
                            if (byCategory && !(byCategory as readonly string[]).includes(filters.testType)) {
                                newFilters.testType = '';
                            }
                        }
                        onChange(newFilters);
                    }}
                    options={testCategoryOptions}
                    testId="TestCategoryFilterSelect"
                />

                <SelectFilter
                    label="Тип испытания"
                    value={filters.testType}
                    onChange={v => handleChange('testType', v)}
                    options={testTypeOptions}
                    testId="TestTypeFilterSelect"
                />
            </FilterGroup>

            {/* ── 4. Диапазоны ────────────────────────────────── */}
            <FilterGroup
                title="Диапазоны"
                icon={<CalendarDays className="w-3.5 h-3.5" />}
                activeCount={rangeCount}
            >
                <RangeFilter label="Длительность (мин)" minValue={filters.durationMin} maxValue={filters.durationMax}
                    onMinChange={v => handleChange('durationMin', v)} onMaxChange={v => handleChange('durationMax', v)} />

                <RangeFilter label="Температура (°C)" minValue={filters.tempMin} maxValue={filters.tempMax}
                    onMinChange={v => handleChange('tempMin', v)} onMaxChange={v => handleChange('tempMax', v)} />

                <RangeFilter label="Вязкость (сП)" minValue={filters.viscosityMin} maxValue={filters.viscosityMax}
                    onMinChange={v => handleChange('viscosityMin', v)} onMaxChange={v => handleChange('viscosityMax', v)} />

                {/* Touch-point sub-section inside Диапазоны */}
                <div data-testid="TouchPointFiltersSection" className="pt-3 border-t border-border/40 space-y-3">
                    <div className="flex items-center gap-1.5 text-xs text-cyan-400 font-medium">
                        <Waypoints className="w-3.5 h-3.5" />
                        <span>Точка касания</span>
                    </div>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                        Момент падения вязкости ниже выбранного порога (распад
                        геля). Целевое время — 10 мин.
                    </p>

                    <ViscosityThresholdSelector
                        value={filters.viscosityThreshold}
                        onChange={handleThresholdChange}
                    />

                    {isTouchPointFilterActive && (
                        <div data-testid="TouchPointSubfilters" className="space-y-3">
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={toggleHasCrossing}
                                    id="has-crossing-toggle"
                                    role="switch"
                                    aria-checked={isHasCrossingOn}
                                    aria-label={`Только достигшие порога ${thresholdLabelText}`}
                                    data-testid="HasCrossingFilterToggle"
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                                        isHasCrossingOn ? 'bg-cyan-600' : 'bg-secondary'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform duration-200 ${
                                            isHasCrossingOn ? 'translate-x-4' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                                <label
                                    htmlFor="has-crossing-toggle"
                                    className="text-xs text-muted-foreground cursor-pointer select-none"
                                >
                                    Только достигшие порога {thresholdLabelText}
                                </label>
                            </div>
                            {touchPointHints.hasCrossing && (
                                <p
                                    data-testid="HasCrossingCoverageHint"
                                    className="text-[10px] leading-snug text-muted-foreground -mt-1"
                                >
                                    {touchPointHints.hasCrossing}
                                </p>
                            )}

                            <RangeFilter
                                label="Время касания (мин)"
                                minValue={filters.crossingTimeMin}
                                maxValue={filters.crossingTimeMax}
                                onMinChange={v => handleChange('crossingTimeMin', v)}
                                onMaxChange={v => handleChange('crossingTimeMax', v)}
                                minTestId="CrossingTimeMinInput"
                                maxTestId="CrossingTimeMaxInput"
                                hint={touchPointHints.crossingTime}
                                hintTestId="CrossingTimeRangeHint"
                            />

                            <RangeFilter
                                label="Вязкость на 10 мин (сП)"
                                minValue={filters.viscosityAtTargetMin}
                                maxValue={filters.viscosityAtTargetMax}
                                onMinChange={v => handleChange('viscosityAtTargetMin', v)}
                                onMaxChange={v => handleChange('viscosityAtTargetMax', v)}
                                minTestId="ViscosityAtTargetMinInput"
                                maxTestId="ViscosityAtTargetMaxInput"
                                hint={touchPointHints.viscosityAtTarget}
                                hintTestId="ViscosityAtTargetRangeHint"
                            />
                        </div>
                    )}
                </div>
            </FilterGroup>

            {/* ── 5. QA / Реагенты ────────────────────────────── */}
            <FilterGroup
                title="QA / Реагенты"
                icon={<Beaker className="w-3.5 h-3.5" />}
                activeCount={qaCount}
            >
                <div className="space-y-2">
                    <label className="block text-xs text-purple-400 font-medium">Партия реагента</label>
                    <Input
                        type="text"
                        value={filters.batchNumber}
                        onChange={e => handleChange('batchNumber', e.target.value)}
                        data-testid="BatchNumberFilterInput"
                        className="bg-card border-purple-500/30 text-foreground focus-visible:ring-purple-500"
                        placeholder="№ партии..."
                    />
                </div>

                <div>
                    <label className="block text-xs text-purple-400 mb-1 font-medium">Реагент</label>
                    {filters.reagentNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                            {filters.reagentNames.map(name => (
                                <span
                                    key={name}
                                    className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-purple-600/20 border border-purple-500/40 text-purple-300"
                                >
                                    {name}
                                    <button
                                        type="button"
                                        onClick={() => removeReagent(name)}
                                        className="text-purple-400 hover:text-foreground transition-colors"
                                        aria-label={`Убрать ${name}`}
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <ReagentAutocomplete
                        value=""
                        onChange={v => { if (v) addReagent(v); }}
                        placeholder={filters.reagentNames.length > 0 ? 'Добавить ещё...' : 'Выберите реагент...'}
                        dropdownLayout="inline"
                    />
                </div>
            </FilterGroup>
        </div>
    );
}

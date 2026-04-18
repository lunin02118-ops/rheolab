import { useEffect, useMemo, useState } from 'react';
import type { ExperimentFilters as FilterState } from '@/types/experiment-filters';
import { EMPTY_FILTERS } from '@/types/experiment-filters';
import { Filter, X, Ruler } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ReagentAutocomplete } from '@/components/ui/reagent-autocomplete';
import { FieldCombobox } from '@/components/ui/field-combobox';
import { TextFilter, SelectFilter, RangeFilter } from './filter-components';
import { getExperimentFilterMetadata } from '@/lib/experiments/client';
import { logger } from '@/lib/logger';
import { FLUID_TYPES, FLUID_TYPE_LABELS } from '@/lib/constants/fluid-types';
import { TEST_CATEGORY_LABELS, TEST_TYPE_LABELS, TEST_TYPES_BY_CATEGORY, type TestCategory, type TestType } from '@/lib/constants/test-types';

interface ExperimentFiltersProps {
    filters: FilterState;
    onChange: (filters: FilterState) => void;
}

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

export function ExperimentFilters({ filters, onChange }: ExperimentFiltersProps) {
    const [metadataError, setMetadataError] = useState<string | null>(null);
    const [metadataOptions, setMetadataOptions] = useState<{
        instrumentTypes: string[];
        fluidTypes: string[];
        geometries: string[];
        waterSources: string[];
        fieldNames: string[];
        testCategories: string[];
        testTypes: string[];
    }>({
        instrumentTypes: [],
        fluidTypes: [],
        geometries: [],
        waterSources: [],
        fieldNames: [],
        testCategories: [],
        testTypes: [],
    });

    useEffect(() => {
        let mounted = true;

        getExperimentFilterMetadata()
            .then((metadata) => {
                if (!mounted) {
                    return;
                }

                setMetadataOptions({
                    instrumentTypes: metadata.instrumentTypes ?? [],
                    fluidTypes: metadata.fluidTypes ?? [],
                    geometries: metadata.geometries ?? [],
                    waterSources: metadata.waterSources ?? [],
                    fieldNames: metadata.fieldNames ?? [],
                    testCategories: metadata.testCategories ?? [],
                    testTypes: metadata.testTypes ?? [],
                });
            })
            .catch((error) => {
                logger.warn('Failed to load filter metadata, using fallback options', error);
                if (mounted) setMetadataError('Не удалось загрузить параметры фильтрации');
            });

        return () => {
            mounted = false;
        };
    }, []);

    const fluidOptions = useMemo(() => {
        if (metadataOptions.fluidTypes.length === 0) {
            return FLUID_TYPE_OPTIONS;
        }

        return [
            { value: '', label: 'Все типы' },
            ...metadataOptions.fluidTypes.map((value) => ({
                value,
                label: FLUID_TYPE_LABELS[value as keyof typeof FLUID_TYPE_LABELS] ?? value,
            })),
        ];
    }, [metadataOptions.fluidTypes]);

    const instrumentOptions = useMemo(() => {
        if (metadataOptions.instrumentTypes.length === 0) {
            return INSTRUMENT_OPTIONS;
        }

        return [
            { value: '', label: 'Все приборы' },
            ...metadataOptions.instrumentTypes.map((value) => ({
                value,
                label: value,
            })),
        ];
    }, [metadataOptions.instrumentTypes]);

    const geometryOptions = useMemo(() => {
        if (metadataOptions.geometries.length === 0) {
            return GEOMETRY_OPTIONS;
        }

        return [
            { value: '', label: 'Все геометрии' },
            ...metadataOptions.geometries.map((value) => ({
                value,
                label: value,
            })),
        ];
    }, [metadataOptions.geometries]);

    const testCategoryOptions = useMemo(() => {
        const cats = metadataOptions.testCategories.length > 0
            ? metadataOptions.testCategories
            : [];
        return [
            { value: '', label: 'Все категории' },
            ...cats.map(c => ({
                value: c,
                label: TEST_CATEGORY_LABELS[c as TestCategory] ?? c,
            })),
        ];
    }, [metadataOptions.testCategories]);

    const testTypeOptions = useMemo(() => {
        // If a category is selected, show only its test types; otherwise show all from metadata
        let types: string[];
        if (filters.testCategory) {
            const byCategory = TEST_TYPES_BY_CATEGORY[filters.testCategory as TestCategory];
            types = byCategory ? [...byCategory] : [];
        } else {
            types = metadataOptions.testTypes.length > 0 ? metadataOptions.testTypes : [];
        }
        return [
            { value: '', label: 'Все типы испытаний' },
            ...types.map(t => ({
                value: t,
                label: TEST_TYPE_LABELS[t as TestType] ?? t,
            })),
        ];
    }, [metadataOptions.testTypes, filters.testCategory]);

    const handleChange = (key: keyof FilterState, value: string) => {
        onChange({ ...filters, [key]: value });
    };

    const clearFilters = () => {
        onChange({ ...EMPTY_FILTERS });
    };

    const hasActiveFilters = Object.values(filters).some(v =>
        Array.isArray(v) ? v.length > 0 : v !== ''
    );

    const addReagent = (name: string) => {
        if (name && !filters.reagentNames.includes(name)) {
            onChange({ ...filters, reagentNames: [...filters.reagentNames, name] });
        }
    };

    const removeReagent = (name: string) => {
        onChange({ ...filters, reagentNames: filters.reagentNames.filter(r => r !== name) });
    };

    return (
        <div data-testid="ExperimentFiltersPanel" className="bg-secondary/50 rounded-xl border border-border p-3 sticky top-24 overflow-y-auto max-h-[calc(100vh-7rem)] scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700">
            {metadataError && (
                <div className="mb-3 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-center gap-1.5">
                    <span>⚠</span> {metadataError}
                </div>
            )}
            <div className="flex items-center justify-between mb-4">
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

            <div className="space-y-4">
                <TextFilter label="Общий поиск" value={filters.searchQuery}
                    onChange={v => handleChange('searchQuery', v)} placeholder="Имя, файл, реагент..." showSearch testId="ExperimentSearchInput" />

                <TextFilter label="Название теста" value={filters.testName}
                    onChange={v => handleChange('testName', v)} placeholder="Название эксперимента..." testId="ExperimentNameFilterInput" />

                <TextFilter label="Лаборатория" value={filters.laboratoryName}
                    onChange={v => handleChange('laboratoryName', v)} placeholder="Название лаб..." testId="ExperimentLaboratoryFilterInput" />

                {/* Месторождение — combobox with static + DB-loaded suggestions */}
                <div className="space-y-2">
                    <label className="text-xs text-muted-foreground block">Месторождение</label>
                    <FieldCombobox
                        value={filters.fieldName}
                        onChange={v => handleChange('fieldName', v)}
                        extraSuggestions={metadataOptions.fieldNames}
                        testId="ExperimentFieldFilterInput"
                        inputClassName="bg-card border-border text-foreground focus-visible:ring-blue-500"
                        placeholder="Поиск..."
                    />
                </div>

                <TextFilter label="Оператор" value={filters.operatorName}
                    onChange={v => handleChange('operatorName', v)} placeholder="Фамилия..." testId="ExperimentOperatorFilterInput" />

                <TextFilter label="Скважина / Куст" value={filters.wellNumber}
                    onChange={v => handleChange('wellNumber', v)} placeholder="Номер скважины..." testId="ExperimentWellFilterInput" />

                <TextFilter label="Источник воды" value={filters.waterSource}
                    onChange={v => handleChange('waterSource', v)}
                    placeholder={metadataOptions.waterSources.length > 0
                        ? `Например: ${metadataOptions.waterSources[0]}`
                        : 'Источник воды...'}
                    testId="ExperimentWaterFilterInput"
                />

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

                {/* Тип эксперимента (категория + метод) */}
                <div className="pt-4 border-t border-border space-y-4">
                    <SelectFilter
                        label="Категория теста"
                        value={filters.testCategory}
                        onChange={v => {
                            // When category changes, reset testType if it doesn't belong to the new category
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
                </div>

                {/* QA Search Section */}
                <div className="pt-4 border-t border-border space-y-2">
                    <label className="block text-xs text-purple-400 font-medium">QA Поиск по партии</label>
                    <Input
                        type="text"
                        value={filters.batchNumber}
                        onChange={e => handleChange('batchNumber', e.target.value)}
                        data-testid="BatchNumberFilterInput"
                        className="bg-card border-purple-500/30 text-foreground focus-visible:ring-purple-500"
                        placeholder="№ партии реагента..."
                    />
                </div>

                <div>
                    <label className="block text-xs text-purple-400 mb-1 font-medium">QA Поиск по реагенту</label>
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
                    />
                </div>
            </div>

            {/* Range Filters */}
            <RangeFilter label="Дата теста" minValue={filters.dateFrom} maxValue={filters.dateTo}
                onMinChange={v => handleChange('dateFrom', v)} onMaxChange={v => handleChange('dateTo', v)} type="date" />

            <RangeFilter label="Длительность (мин)" minValue={filters.durationMin} maxValue={filters.durationMax}
                onMinChange={v => handleChange('durationMin', v)} onMaxChange={v => handleChange('durationMax', v)} />

            <RangeFilter label="Температура (°C)" minValue={filters.tempMin} maxValue={filters.tempMax}
                onMinChange={v => handleChange('tempMin', v)} onMaxChange={v => handleChange('tempMax', v)} />

            <RangeFilter label="Вязкость (сП)" minValue={filters.viscosityMin} maxValue={filters.viscosityMax}
                onMinChange={v => handleChange('viscosityMin', v)} onMaxChange={v => handleChange('viscosityMax', v)} />
        </div>
    );
}

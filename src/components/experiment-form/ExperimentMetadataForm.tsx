import React from 'react';
import { Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldCombobox } from '@/components/ui/field-combobox';

interface LaboratoryOption {
    id: string;
    name: string;
}

interface ExperimentMetadataFormProps {
    name: string;
    setName: (value: string) => void;
    fieldName: string;
    setFieldName: (value: string) => void;
    operatorName: string;
    setOperatorName: (value: string) => void;
    /** List of operator names from the Operator table for the datalist. */
    operatorOptions?: string[];
    wellNumber: string;
    setWellNumber: (value: string) => void;
    testDate: Date;
    setTestDate: (value: Date) => void;
    onSmartFill: () => void;
    /** Selected laboratory id (empty string = none) */
    laboratoryId?: string;
    setLaboratoryId?: (id: string) => void;
    /** Available laboratories for the dropdown */
    laboratoryOptions?: LaboratoryOption[];
}

export function ExperimentMetadataForm({
    name,
    setName,
    fieldName,
    setFieldName,
    operatorName,
    setOperatorName,
    operatorOptions = [],
    wellNumber,
    setWellNumber,
    testDate,
    setTestDate,
    onSmartFill,
    laboratoryId = '',
    setLaboratoryId,
    laboratoryOptions = [],
}: ExperimentMetadataFormProps) {
    const inputCls = 'text-foreground focus-visible:ring-cyan-500 dark:bg-secondary/30';
    const errorBorder = 'border-2 border-destructive';

    return (
        <div className="bg-card dark:bg-card rounded-xl border border-border overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/50 bg-muted/30 dark:bg-secondary/40">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Метаданные</h3>
                <button
                    onClick={onSmartFill}
                    type="button"
                    data-testid="SaveDialogSmartFillButton"
                    className="text-xs text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 flex items-center gap-1 transition-colors"
                    title="Распознать из имени файла"
                >
                    <Sparkles className="w-3 h-3" />
                    Автозаполнение
                </button>
            </div>

            {/* Section body */}
            <div className="p-5">
                <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    {/* Название теста */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground">
                            Название теста <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            data-testid="SaveDialogNameTextBox"
                            className={`${inputCls} ${!name.trim() ? errorBorder : ''}`}
                            placeholder="Тест геля 25°C"
                        />
                    </div>

                    {/* Месторождение */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground">
                            Месторождение
                        </Label>
                        <FieldCombobox
                            value={fieldName}
                            onChange={setFieldName}
                            testId="SaveDialogFieldTextBox"
                            inputClassName={inputCls}
                            placeholder="Самотлорское"
                        />
                    </div>

                    {/* Оператор */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground">
                            Оператор <span className="text-destructive">*</span>
                        </Label>
                        <FieldCombobox
                            value={operatorName}
                            onChange={setOperatorName}
                            staticList={operatorOptions}
                            entityLabel="Оператор"
                            testId="SaveDialogOperatorTextBox"
                            inputClassName={`${inputCls} ${!operatorName.trim() ? errorBorder : ''}`}
                            placeholder="Иванов И.И."
                        />
                    </div>

                    {/* Скважина / Куст */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground">
                            Скважина / Куст
                        </Label>
                        <Input
                            type="text"
                            value={wellNumber}
                            onChange={e => setWellNumber(e.target.value)}
                            data-testid="SaveDialogWellTextBox"
                            className={inputCls}
                            placeholder="К-123/5"
                        />
                    </div>

                    {/* Дата теста */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground">Дата проведения теста</Label>
                        <Input
                            type="date"
                            value={testDate ? new Date(testDate).toISOString().split('T')[0] : ''}
                            onChange={e => setTestDate(e.target.value ? new Date(e.target.value) : new Date())}
                            data-testid="SaveDialogTestDatePicker"
                            className={inputCls}
                        />
                    </div>

                    {/* Лаборатория */}
                    {(laboratoryOptions.length > 0 || setLaboratoryId) && (
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold text-foreground">Лаборатория</Label>
                            <select
                                value={laboratoryId}
                                onChange={e => setLaboratoryId?.(e.target.value)}
                                data-testid="SaveDialogLaboratorySelect"
                                className="w-full h-9 bg-transparent dark:bg-secondary/30 border border-input rounded-md px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
                            >
                                <option value="">— Не указана —</option>
                                {laboratoryOptions.map(lab => (
                                    <option key={lab.id} value={lab.id}>{lab.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


import { useExperimentDataStore } from '@/lib/store/experiment-data-store';
import { useAnalysisPipeline } from '@/hooks/useAnalysisPipeline';
import { useUIMode } from '@/contexts/ui-mode-context';
import { ReportsPanel } from '@/components/reports/ReportsPanel';
import { FileText } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

// Module-level constant — stable reference that prevents useAnalysisPipeline
// from restarting the heavy analysis on every render of this page.
const NOOP_SET_ERROR = (_: string | null) => {};

export default function ReportsPage() {
    const { isExpert } = useUIMode();
    const {
        parseResult,
        recipe,
        waterSource,
        waterParams,
        cycleOverrides,
        patternOverride,
    } = useExperimentDataStore(
        useShallow(s => ({
            parseResult:    s.parseResult,
            recipe:         s.recipe,
            waterSource:    s.waterSource,
            waterParams:    s.waterParams,
            cycleOverrides: s.cycleOverrides,
            patternOverride: s.patternOverride,
        }))
    );

    // Re-run analysis pipeline with the same overrides set on the Dashboard.
    // The module-level cache in useAnalysisPipeline will produce a cache hit
    // when the user hasn't changed inputs — no redundant Rust IPC.
    const { cycleResults, cycles } = useAnalysisPipeline({
        parseResult,
        isExpert,
        cycleOverrides,
        patternOverride,
        setError: NOOP_SET_ERROR
    });

    if (!parseResult) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center max-w-md px-6">
                    <div className="w-16 h-16 bg-card rounded-full flex items-center justify-center mx-auto mb-6 border border-border">
                        <FileText className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground mb-2">Нет данных для отчёта</h2>
                    <p className="text-muted-foreground">
                        Пожалуйста, загрузите файл эксперимента на вкладке "Анализ", чтобы сгенерировать отчёт.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <main className="w-full px-6 py-8">
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                        <FileText className="w-8 h-8 text-blue-400" />
                        Генерация отчёта
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Настройка и экспорт PDF-отчёта для эксперимента: <span className="text-foreground font-medium">{parseResult.metadata.filename}</span>
                    </p>
                </div>

                <ReportsPanel
                    parseResult={parseResult}
                    editedRecipe={recipe}
                    editedWaterParams={waterParams}
                    editedWaterSource={waterSource}
                    cycleResults={cycleResults}
                    cycles={cycles}
                />
            </main>
        </div>
    );
}

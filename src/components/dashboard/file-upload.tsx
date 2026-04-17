import { useState, useCallback, useEffect } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useShallow } from 'zustand/react/shallow';
import { useExperimentDataStore } from '@/lib/store/experiment-data-store';
import type { ParseResult } from '@/types';
import { parseRheologyFile, MAX_FILE_SIZE } from '@/lib/parsing/client';

function waitForIdle(timeout = 50): Promise<void> {
    return new Promise((resolve) => {
        if (typeof globalThis.requestIdleCallback === 'function') {
            globalThis.requestIdleCallback(() => resolve(), { timeout });
            return;
        }

        setTimeout(resolve, 0);
    });
}

interface FileUploadProps {
    onFileProcessed: (result: ParseResult) => void;
    onError: (error: string) => void;
    isLoading?: boolean;
    /** External file name — shows success state when data loaded from demo/library */
    loadedFileName?: string | null;
    /** External loading indicator — shows uploading state during fixture/library load */
    externalLoading?: boolean;
    /** Called when user clicks "Загрузить другой файл" in success state */
    onReset?: () => void;
}

export function FileUpload({ onFileProcessed, onError, isLoading, loadedFileName, externalLoading, onReset }: FileUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [internalUploadState, setInternalUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
    const [internalFileName, setInternalFileName] = useState<string | null>(null);
    const { expertSettings, setExpertSettings } = useAnalysisSettingsStore(
        useShallow(s => ({ expertSettings: s.expertSettings, setExpertSettings: s.setExpertSettings }))
    );

    // When an external file load starts (demo/library), reset internal state so
    // externalLoading and loadedFileName can take control of the displayed state.
    useEffect(() => {
        if (externalLoading) {
            setInternalUploadState('idle');
            setInternalFileName(null);
        }
    }, [externalLoading]);

    // Derive effective state: external state takes priority when internal is idle
    const uploadState: 'idle' | 'uploading' | 'success' | 'error' =
        internalUploadState !== 'idle'
            ? internalUploadState
            : externalLoading
                ? 'uploading'
                : loadedFileName
                    ? 'success'
                    : 'idle';

    const fileName = internalFileName || loadedFileName || null;

    const handleFile = useCallback(async (file: File) => {
        if (!file) return;

        // Validate file type
        const ext = file.name.split('.').pop()?.toLowerCase();
        const allowedExtensions = ['xlsx', 'xls', 'csv', 'txt', 'dat'];

        if (!ext || !allowedExtensions.includes(ext)) {
            onError(`Неподдерживаемый формат файла: .${ext}`);
            setInternalUploadState('error');
            return;
        }

        setInternalFileName(file.name);
        setInternalUploadState('uploading');

        try {
            // Release previous experiment data from memory before allocating new parse result.
            // reset() clears columnarData/rawPoints from the Zustand store; the idle yield
            // gives V8 a chance to GC the old Float64Arrays before the next allocation.
            useExperimentDataStore.getState().reset();
            await waitForIdle();

            // API key is resolved server-side by the Rust parsing command
            const result = await parseRheologyFile(file, {
                aiModel: expertSettings.aiModel,
                forceAI: expertSettings.forceAiParsing,
            });

            setInternalUploadState('success');
            onFileProcessed(result);
        } catch (error) {
            setInternalUploadState('error');
            onError(error instanceof Error ? error.message : 'Неизвестная ошибка');
        }
    }, [onFileProcessed, onError, expertSettings.aiModel, expertSettings.forceAiParsing]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        // Reset input value so re-selecting the same file triggers onChange again
        e.target.value = '';
    }, [handleFile]);

    const resetUpload = useCallback(() => {
        setInternalUploadState('idle');
        setInternalFileName(null);
        onReset?.();
    }, [onReset]);

    return (
        <>
        <div
            data-testid="FileUploadCard"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
                "relative border-2 border-dashed rounded-xl p-10 transition-[border-color,background-color,box-shadow] duration-500 cursor-pointer group overflow-hidden",
                "bg-gradient-to-br from-card/70 to-secondary/70",
                isDragging && "border-blue-500 bg-blue-500/10 scale-[1.02] shadow-2xl shadow-blue-500/20",
                uploadState === 'idle' && "border-border hover:border-blue-500/50 hover:bg-secondary/80 hover:shadow-xl hover:shadow-blue-500/10",
                uploadState === 'uploading' && "border-amber-500 bg-amber-500/5 shadow-lg shadow-amber-500/10",
                uploadState === 'success' && "border-emerald-500 bg-emerald-500/5 shadow-lg shadow-emerald-500/10",
                uploadState === 'error' && "border-red-500 bg-red-500/5 shadow-lg shadow-red-500/10"
            )}
        >
            <input
                type="file"
                accept=".xlsx,.xls,.csv,.txt,.dat"
                onChange={handleInputChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-[-2px] focus-visible:opacity-100 focus-visible:bg-blue-500/10"
                disabled={isLoading || uploadState === 'uploading'}
                aria-label="Загрузить файл эксперимента"
            />

            {/* Background Glow Effect */}
            <div className={cn(
                "absolute inset-0 transition-opacity duration-700 pointer-events-none",
                uploadState === 'idle' && "bg-gradient-to-r from-blue-500/0 via-blue-500/5 to-purple-500/0 opacity-0 group-hover:opacity-100",
                uploadState === 'uploading' && "bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-orange-500/10 opacity-100 animate-pulse",
                uploadState === 'success' && "bg-gradient-to-r from-emerald-500/10 via-emerald-400/5 to-green-500/10 opacity-100",
                uploadState === 'error' && "bg-gradient-to-r from-red-500/10 via-red-400/5 to-rose-500/10 opacity-100"
            )} />

            {/* Animated shimmer bar for uploading */}
            {uploadState === 'uploading' && (
                <div className="absolute inset-x-0 top-0 h-1 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-shimmer" />
                </div>
            )}

            {/* Success pulse ring */}
            {uploadState === 'success' && (
                <div className="absolute inset-0 rounded-xl border-2 border-emerald-400/30 animate-ping-slow pointer-events-none" />
            )}
            {isDragging && <span data-testid="UploadCardDragOverState" className="sr-only">drag-over</span>}

            <div className="relative flex flex-col items-center gap-6 text-center pointer-events-none z-20">
                {uploadState === 'idle' && (
                    <div data-testid="UploadCardIdleState" className="contents">
                        <div className="relative">
                            <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }} />
                            <div className="relative p-5 bg-gradient-to-br from-secondary to-card rounded-2xl border border-border shadow-xl group-hover:scale-110 transition-transform duration-300">
                                <Upload className="w-10 h-10 text-blue-400 group-hover:text-blue-300 transition-colors" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-foreground tracking-tight group-hover:text-blue-200 transition-colors">
                                Загрузите файл реологии
                            </h3>
                            <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
                                Перетащите файл сюда или нажмите для выбора.
                                <br />
                                <span className="text-muted-foreground text-sm">
                                    Поддерживаем Grace, Chandler, Fann 50
                                </span>
                            </p>
                        </div>

                        <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground bg-card/50 px-3 py-1.5 rounded-full border border-border">
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>.xlsx, .csv, .txt, .dat</span>
                            <span className="w-1 h-1 bg-muted rounded-full" />
                            <span>Max {MAX_FILE_SIZE / 1024 / 1024}MB</span>
                        </div>
                    </div>
                )}

                {uploadState === 'uploading' && (
                    <div data-testid="UploadCardLoadingState" className="contents animate-fade-in">
                        <div className="relative">
                            <div className="absolute inset-0 rounded-2xl opacity-30 animate-pulse pointer-events-none" style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
                            <div className="relative p-5 bg-gradient-to-br from-secondary to-card rounded-2xl border border-amber-500/40 shadow-xl shadow-amber-500/10 animate-bounce-gentle">
                                <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-lg font-semibold text-foreground">
                                Анализируем структуру...
                            </h3>
                            <p data-testid="UploadCardLoadingFileName" className="text-sm text-amber-700 dark:text-amber-400 font-mono">{fileName}</p>
                            <div className="flex items-center gap-2 justify-center mt-2">
                                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}

                {uploadState === 'success' && (
                    <div data-testid="UploadCardSuccessState" className="contents animate-scale-in">
                        <div className="relative">
                            <div className="absolute inset-0 rounded-2xl opacity-25 pointer-events-none" style={{ background: 'radial-gradient(circle, #10b981 0%, transparent 70%)' }} />
                            <div className="relative p-5 bg-gradient-to-br from-secondary to-card rounded-2xl border border-emerald-500/40 shadow-xl shadow-emerald-500/10">
                                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                                Файл успешно обработан
                            </h3>
                            <p data-testid="UploadCardSuccessFileName" className="text-sm text-emerald-700 dark:text-emerald-400 font-mono mb-2">{fileName}</p>

                            <Button
                                variant="link"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    resetUpload();
                                }}
                                data-testid="UploadCardResetLink"
                                className="text-muted-foreground hover:text-foreground h-auto p-0 underline pointer-events-auto z-30 relative"
                            >
                                Загрузить другой файл
                            </Button>
                        </div>
                    </div>
                )}

                {uploadState === 'error' && (
                    <div data-testid="UploadCardErrorState" className="contents">
                        <div className="relative">
                            <div className="absolute inset-0 rounded-2xl opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 70%)' }} />
                            <div className="relative p-5 bg-gradient-to-br from-secondary to-card rounded-2xl border border-red-500/30 shadow-xl">
                                <AlertCircle className="w-10 h-10 text-red-400" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-lg font-semibold text-foreground">
                                Ошибка обработки
                            </h3>
                            <p className="text-sm text-red-600 dark:text-red-400 font-mono mb-2">{fileName}</p>

                            <Button
                                variant="link"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    resetUpload();
                                }}
                                className="text-muted-foreground hover:text-foreground h-auto p-0 underline pointer-events-auto z-30 relative"
                            >
                                Попробовать снова
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* AI Parsing toggle */}
        <div className="flex items-center gap-3 px-1 pt-3">
            <button
                onClick={() => setExpertSettings({ forceAiParsing: !expertSettings.forceAiParsing })}
                id="force-ai-parsing-toggle"
                role="switch"
                aria-checked={expertSettings.forceAiParsing}
                aria-label="Принудительный AI-парсинг"
                className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                    expertSettings.forceAiParsing ? "bg-blue-600" : "bg-secondary"
                )}
            >
                <span className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform duration-200",
                    expertSettings.forceAiParsing ? "translate-x-4" : "translate-x-0"
                )} />
            </button>
            <label
                htmlFor="force-ai-parsing-toggle"
                className="text-sm text-muted-foreground cursor-pointer select-none"
            >
                Принудительный AI-парсинг
            </label>
            {expertSettings.forceAiParsing && (
                <span className="text-xs text-blue-400/70 font-mono">llama-4-scout</span>
            )}
        </div>
        </>
    );
}

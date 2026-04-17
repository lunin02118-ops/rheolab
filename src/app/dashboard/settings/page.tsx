import { Suspense, Component, useState, useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Monitor, Moon, Sun, Languages, Database,
    BrainCircuit, Key,
    LayoutTemplate, Info, Settings as SettingsIcon,
    LineChart, FileText, AlertTriangle,
    RefreshCw, Loader2, CheckCircle2, Wifi, WifiOff
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useTheme } from '@/contexts/theme-context';
import { ExpertSettingsPanel } from '@/components/analysis/expert-settings-panel';
import { APIKeyManager } from '@/components/settings/APIKeyManager';
import { BackupManager } from '@/components/settings/BackupManager';
import { ExperimentExportImport } from '@/components/settings/ExperimentExportImport';
import { BrandingManager } from '@/components/settings/BrandingManager';
import { ChartSettingsManager } from '@/components/settings/ChartSettingsManager';
import { ReportSettingsManager } from '@/components/settings/ReportSettingsManager';
import { AppSettingsExporter } from '@/components/settings/AppSettingsExporter';
import { OperatorManager } from '@/components/settings/OperatorManager';
import { LaboratoryManager } from '@/components/settings/LaboratoryManager';
import { APP_VERSION, BUILD_DATE, COMMIT_HASH } from '@/lib/version';
import { useUpdateStore } from '@/lib/store/update-store';
import { checkUpdateNow } from '@/components/shared/UpdateChecker';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Error boundary to catch rendering crashes in individual settings sections
class SettingsErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
    state: { error: Error | null } = { error: null };
    static getDerivedStateFromError(error: Error) { return { error }; }
    render() {
        if (this.state.error) {
            return (
                <div className="p-4 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-medium">Ошибка в разделе «{this.props.name}»</span>
                    </div>
                    <p className="text-xs text-red-600/70 dark:text-red-400/70 font-mono">{this.state.error.message}</p>
                    <button
                        className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={() => this.setState({ error: null })}
                    >Попробовать снова</button>
                </div>
            );
        }
        return this.props.children;
    }
}

function SettingsContent() {
    const { mode, setMode } = useUIMode();
    const { theme, setTheme } = useTheme();
    const [searchParams] = useSearchParams();

    // Read tab from URL query params (e.g., ?tab=reports)
    const tabFromUrl = searchParams.get('tab');
    const validTabs = ['general', 'data', 'analysis', 'charts', 'reports', 'system'];
    // In beginner mode, analysis tab is hidden — silently fall back to general
    const isExpertMode = mode === 'expert';
    const resolvedTab = validTabs.includes(tabFromUrl || '') ? tabFromUrl! : 'general';
    const defaultTab = (!isExpertMode && resolvedTab === 'analysis') ? 'general' : resolvedTab;

    return (
        <div data-testid="SettingsViewRoot" className="min-h-screen bg-background p-6 space-y-8">
            <header className="max-w-5xl mx-auto mb-8">
                <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                    <SettingsIcon className="w-8 h-8 text-blue-500" />
                    Настройки
                </h1>
                <p className="text-muted-foreground mt-2">Управление конфигурацией приложения, данными и внешним видом</p>
            </header>

            <main className="max-w-5xl mx-auto">
                <Tabs defaultValue={defaultTab} className="space-y-6">
                    <TabsList data-testid="SettingsMainTabs" className={`grid w-full ${isExpertMode ? 'grid-cols-6' : 'grid-cols-5'} bg-card/50 p-1 border border-border rounded-xl h-auto`}>
                        <TabsTrigger value="general" className="flex items-center gap-2 py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white transition-colors">
                            <LayoutTemplate className="w-4 h-4" />
                            <span>Общие</span>
                        </TabsTrigger>
                        <TabsTrigger value="data" className="flex items-center gap-2 py-3 data-[state=active]:bg-green-600 data-[state=active]:text-white transition-colors">
                            <Database className="w-4 h-4" />
                            <span>Данные</span>
                        </TabsTrigger>
                        {isExpertMode && (
                        <TabsTrigger value="analysis" className="flex items-center gap-2 py-3 data-[state=active]:bg-purple-600 data-[state=active]:text-white transition-colors">
                            <BrainCircuit className="w-4 h-4" />
                            <span>Анализ</span>
                        </TabsTrigger>
                        )}
                        <TabsTrigger value="charts" className="flex items-center gap-2 py-3 data-[state=active]:bg-cyan-600 data-[state=active]:text-white transition-colors">
                            <LineChart className="w-4 h-4" />
                            <span>Графики</span>
                        </TabsTrigger>
                        <TabsTrigger value="reports" className="flex items-center gap-2 py-3 data-[state=active]:bg-amber-600 data-[state=active]:text-white transition-colors">
                            <FileText className="w-4 h-4" />
                            <span>Отчёты</span>
                        </TabsTrigger>
                        <TabsTrigger value="system" className="flex items-center gap-2 py-3 data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-colors">
                            <SettingsIcon className="w-4 h-4" />
                            <span>Система</span>
                        </TabsTrigger>
                    </TabsList>

                    {/* === GENERAL TAB === */}
                    <TabsContent value="general" className="space-y-6">
                        {/* Interface Mode */}
                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-foreground">
                                    <Monitor className="w-5 h-5 text-blue-400" />
                                    Режим интерфейса
                                </CardTitle>
                                <CardDescription>Выберите уровень сложности интерфейса</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setMode('beginner')}
                                    className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-colors ${mode === 'beginner'
                                        ? 'bg-blue-100 dark:bg-blue-600/20 border-blue-500 text-blue-700 dark:text-blue-400 shadow-lg shadow-blue-900/20'
                                        : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:border-muted-foreground/40'
                                        }`}
                                >
                                    <div className={`p-3 rounded-full ${mode === 'beginner' ? 'bg-blue-500/20' : 'bg-secondary'}`}>
                                        <Moon className="w-6 h-6" />
                                    </div>
                                    <div className="text-center">
                                        <div className="font-semibold mb-1">Базовый</div>
                                        <div className="text-xs opacity-70">Только основные функции</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => setMode('expert')}
                                    className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-colors ${mode === 'expert'
                                        ? 'bg-purple-100 dark:bg-purple-600/20 border-purple-500 text-purple-700 dark:text-purple-400 shadow-lg shadow-purple-900/20'
                                        : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:border-muted-foreground/40'
                                        }`}
                                >
                                    <div className={`p-3 rounded-full ${mode === 'expert' ? 'bg-purple-500/20' : 'bg-secondary'}`}>
                                        <Sun className="w-6 h-6" />
                                    </div>
                                    <div className="text-center">
                                        <div className="font-semibold mb-1">Эксперт</div>
                                        <div className="text-xs opacity-70">Полный контроль параметров</div>
                                    </div>
                                </button>
                            </CardContent>
                        </Card>

                        {/* Theme */}
                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-foreground">
                                    <Sun className="w-5 h-5 text-amber-400" />
                                    Тема оформления
                                </CardTitle>
                                <CardDescription>Выберите цветовую схему интерфейса</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-3 gap-3">
                                <button
                                    onClick={() => setTheme('light')}
                                    className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-colors ${theme === 'light'
                                        ? 'bg-amber-100 dark:bg-amber-600/20 border-amber-500 text-amber-700 dark:text-amber-400 shadow-lg shadow-amber-900/20'
                                        : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:border-muted-foreground/40'
                                        }`}
                                >
                                    <div className={`p-2.5 rounded-full ${theme === 'light' ? 'bg-amber-500/20' : 'bg-muted'}`}>
                                        <Sun className="w-5 h-5" />
                                    </div>
                                    <div className="text-center">
                                        <div className="font-semibold text-sm mb-0.5">Светлая</div>
                                        <div className="text-[10px] opacity-70">Белый фон</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => setTheme('dark')}
                                    className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-colors ${theme === 'dark'
                                        ? 'bg-blue-100 dark:bg-blue-600/20 border-blue-500 text-blue-700 dark:text-blue-400 shadow-lg shadow-blue-900/20'
                                        : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:border-muted-foreground/40'
                                        }`}
                                >
                                    <div className={`p-2.5 rounded-full ${theme === 'dark' ? 'bg-blue-500/20' : 'bg-muted'}`}>
                                        <Moon className="w-5 h-5" />
                                    </div>
                                    <div className="text-center">
                                        <div className="font-semibold text-sm mb-0.5">Тёмная</div>
                                        <div className="text-[10px] opacity-70">Тёмный фон</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => setTheme('system')}
                                    className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-colors ${theme === 'system'
                                        ? 'bg-purple-100 dark:bg-purple-600/20 border-purple-500 text-purple-700 dark:text-purple-400 shadow-lg shadow-purple-900/20'
                                        : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:border-muted-foreground/40'
                                        }`}
                                >
                                    <div className={`p-2.5 rounded-full ${theme === 'system' ? 'bg-purple-500/20' : 'bg-muted'}`}>
                                        <Monitor className="w-5 h-5" />
                                    </div>
                                    <div className="text-center">
                                        <div className="font-semibold text-sm mb-0.5">Системная</div>
                                        <div className="text-[10px] opacity-70">По умолчанию ОС</div>
                                    </div>
                                </button>
                            </CardContent>
                        </Card>

                        {/* Language */}
                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-foreground">
                                    <Languages className="w-5 h-5 text-purple-400" />
                                    Язык интерфейса
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="flex gap-4">
                                <button className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium shadow-lg shadow-blue-900/20 ring-1 ring-blue-500">Русский</button>
                                <button className="px-6 py-2.5 bg-secondary text-muted-foreground rounded-lg text-sm font-medium hover:text-foreground hover:bg-secondary transition-colors border border-border">English (Beta)</button>
                            </CardContent>
                        </Card>
                        <SettingsErrorBoundary name="\u041e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u044b">
                            <OperatorManager />
                        </SettingsErrorBoundary>

                        <SettingsErrorBoundary name="\u041b\u0430\u0431\u043e\u0440\u0430\u0442\u043e\u0440\u0438\u0438">
                            <LaboratoryManager />
                        </SettingsErrorBoundary>                    </TabsContent>

                    {/* === DATA TAB === */}
                    <TabsContent value="data" className="space-y-6">
                        <SettingsErrorBoundary name="Локальное хранилище">
                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-foreground">
                                    <Database className="w-5 h-5 text-green-400" />
                                    Локальное хранилище
                                </CardTitle>
                                <CardDescription>Управление локальной базой данных и резервными копиями</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <BackupManager />
                            </CardContent>
                        </Card>
                        </SettingsErrorBoundary>

                        <SettingsErrorBoundary name="Экспорт/Импорт">
                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-foreground">
                                    <Logo className="w-5 h-5 text-amber-400" />
                                    Экспорт и Импорт экспериментов
                                </CardTitle>
                                <CardDescription>Обмен данными между филиалами организации</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ExperimentExportImport />
                            </CardContent>
                        </Card>
                        </SettingsErrorBoundary>
                    </TabsContent>

                    {/* === ANALYSIS TAB === (expert mode only) */}
                    {isExpertMode && (
                    <TabsContent value="analysis" className="space-y-6">
                        <SettingsErrorBoundary name="Анализ">
                            <ExpertSettingsPanel />
                        </SettingsErrorBoundary>
                    </TabsContent>
                    )}

                    {/* === CHARTS TAB === */}
                    <TabsContent value="charts" className="space-y-6">
                        <SettingsErrorBoundary name="Графики">
                            <ChartSettingsManager />
                        </SettingsErrorBoundary>
                    </TabsContent>

                    {/* === REPORTS TAB === */}
                    <TabsContent value="reports" className="space-y-6">
                        <SettingsErrorBoundary name="Отчёты">
                            <ReportSettingsManager />
                        </SettingsErrorBoundary>
                        <SettingsErrorBoundary name="Брендинг">
                            <BrandingManager />
                        </SettingsErrorBoundary>
                    </TabsContent>

                    {/* === SYSTEM TAB === */}
                    <TabsContent value="system" className="space-y-6">
                        {/* Settings Export/Import */}
                        <SettingsErrorBoundary name="Система">
                        <AppSettingsExporter />

                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-foreground">
                                    <Key className="w-5 h-5 text-yellow-500" />
                                    API Ключи
                                </CardTitle>
                                <CardDescription>Настройка ключей для работы ИИ-ассистента</CardDescription>
                            </CardHeader>
                            <CardContent className="px-0">
                                <div className="px-6">
                                    <APIKeyManager />
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-foreground">
                                    <Info className="w-5 h-5 text-blue-400" />
                                    О программе
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4">
                                    <div className="flex justify-between items-center py-3 border-b border-border">
                                        <span className="text-muted-foreground">Версия</span>
                                        <span className="text-foreground font-mono bg-secondary px-3 py-1 rounded text-sm">{APP_VERSION}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-3 border-b border-border">
                                        <span className="text-muted-foreground">Дата сборки</span>
                                        <span className="text-foreground font-mono bg-secondary px-3 py-1 rounded text-sm">{BUILD_DATE}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-3 border-b border-border">
                                        <span className="text-muted-foreground">Хеш коммита</span>
                                        <span className="text-foreground font-mono bg-secondary px-3 py-1 rounded text-sm">{COMMIT_HASH}</span>
                                    </div>
                                    <div className="flex flex-col py-3">
                                        <div className="flex justify-between items-start">
                                            <span className="text-muted-foreground pt-0.5">Обновление</span>
                                            <UpdateCheckButton />
                                        </div>
                                    </div>
                                    <div className="mt-6 text-xs text-muted-foreground text-center">
                                        © {new Date().getFullYear()} RheoLab Enterprise. Все права защищены.
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        </SettingsErrorBoundary>
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
}

// The exact endpoint pattern from tauri.conf.json with {{target}} resolved.
// Tauri v2 resolves {{target}} to OS-ARCH, e.g. windows-x86_64.
const UPDATE_ENDPOINT = 'https://license.vizbuka.ru/releases/v1/update/windows-x86_64/stable.json';

interface DiagResult {
    url: string;
    status: number | null;
    latencyMs: number | null;
    contentType: string | null;
    serverVersion: string | null;
    jsonOk: boolean;
    error: string | null;
}

function UpdateDiagnosticPanel({ appVersion }: { appVersion: string }) {
    const [result, setResult] = useState<DiagResult | null>(null);
    const [running, setRunning] = useState(false);

    async function runDiag() {
        setRunning(true);
        const start = performance.now();
        const diag: DiagResult = { url: UPDATE_ENDPOINT, status: null, latencyMs: null, contentType: null, serverVersion: null, jsonOk: false, error: null };
        try {
            const res = await fetch(UPDATE_ENDPOINT, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            });
            diag.latencyMs = Math.round(performance.now() - start);
            diag.status = res.status;
            diag.contentType = res.headers.get('content-type');
            if (res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    diag.jsonOk = true;
                    diag.serverVersion = json.version ?? null;
                } catch (e) {
                    diag.error = `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`;
                }
            } else {
                diag.error = `HTTP ${res.status} ${res.statusText}`;
            }
        } catch (e) {
            diag.latencyMs = Math.round(performance.now() - start);
            diag.error = e instanceof Error ? e.message : String(e);
        }
        setResult(diag);
        setRunning(false);
    }

    // Auto-run on mount
    useEffect(() => { void runDiag(); }, []);

    const ok = result && result.jsonOk && result.serverVersion;
    const newer = ok && result.serverVersion
        ? result.serverVersion.replace(/^v/, '').split('.').map(Number)
            .reduce((acc, v, i) => acc || v > appVersion.replace(/^v/, '').split('.').map(Number)[i]!, false as boolean)
        : false;

    return (
        <div className="mt-3 rounded-lg border border-border bg-secondary/60 p-4 text-xs font-mono space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-sans text-xs font-semibold uppercase tracking-wide">Диагностика соединения</span>
                <button
                    onClick={() => runDiag()}
                    disabled={running}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
                >
                    <RefreshCw className={`w-3 h-3 ${running ? 'animate-spin' : ''}`} />
                    <span className="font-sans">{running ? 'Проверка…' : 'Повтор'}</span>
                </button>
            </div>

            <div className="text-muted-foreground break-all">{UPDATE_ENDPOINT}</div>

            {result ? (
                <div className="space-y-1">
                    <Row label="Приложение" value={`v${appVersion}`} />
                    <Row
                        label="HTTP"
                        value={result.status !== null ? String(result.status) : '—'}
                        ok={result.status === 200}
                    />
                    <Row
                        label="Задержка"
                        value={result.latencyMs !== null ? `${result.latencyMs} мс` : '—'}
                    />
                    <Row
                        label="Content-Type"
                        value={result.contentType ?? '—'}
                        ok={result.contentType?.includes('application/json') ?? false}
                    />
                    <Row
                        label="JSON"
                        value={result.jsonOk ? 'Валидный' : 'Ошибка'}
                        ok={result.jsonOk}
                    />
                    {result.serverVersion && (
                        <Row
                            label="Версия на сервере"
                            value={result.serverVersion}
                            ok={newer}
                            note={newer ? 'обновление доступно' : 'актуальная версия'}
                        />
                    )}
                    {result.error && (
                        <div className="mt-2 text-red-400 flex items-start gap-1.5">
                            <WifiOff className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span className="break-all">{result.error}</span>
                        </div>
                    )}
                    {ok && !result.error && (
                        <div className="mt-2 text-emerald-400 flex items-center gap-1.5">
                            <Wifi className="w-3.5 h-3.5" />
                            <span className="font-sans">Сервер обновлений доступен</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Проверка…
                </div>
            )}
        </div>
    );
}

function Row({ label, value, ok, note }: { label: string; value: string; ok?: boolean; note?: string }) {
    return (
        <div className="flex justify-between gap-4">
            <span className="text-muted-foreground font-sans">{label}</span>
            <span className={ok === true ? 'text-emerald-400' : ok === false ? 'text-red-400' : 'text-foreground/80'}>
                {value}{note ? <span className="text-muted-foreground ml-1">({note})</span> : null}
            </span>
        </div>
    );
}

function UpdateCheckButton() {
    const status = useUpdateStore((state) => state.status);
    const version = useUpdateStore((state) => state.version);
    const error = useUpdateStore((state) => state.error);
    const [upToDate, setUpToDate] = useState(false);
    const [showDiag, setShowDiag] = useState(false);
    const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (resetTimerRef.current) {
                clearTimeout(resetTimerRef.current);
            }
        };
    }, []);

    const handleCheck = async () => {
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current);
            resetTimerRef.current = null;
        }
        setUpToDate(false);
        setShowDiag(false);
        await checkUpdateNow();
        const finalStatus = useUpdateStore.getState().status;
        if (finalStatus === 'idle') {
            setUpToDate(true);
            resetTimerRef.current = setTimeout(() => {
                setUpToDate(false);
                resetTimerRef.current = null;
            }, 4000);
        }
        if (finalStatus === 'error') {
            setShowDiag(true);
        }
    };

    if (status === 'available') {
        return (
            <span className="text-purple-400 text-sm font-medium flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Доступно v{version}
            </span>
        );
    }
    if (status === 'downloading' || status === 'ready') {
        return (
            <span className="text-blue-400 text-sm">Установка обновления…</span>
        );
    }
    if (status === 'error') {
        return (
            <div className="w-full">
                <div className="flex items-center justify-between">
                    <span
                        className="text-red-400 text-sm flex items-center gap-1.5 cursor-pointer hover:text-red-300"
                        onClick={handleCheck}
                        title="Нажмите для повторной проверки"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {error ?? 'Ошибка проверки обновлений'}
                    </span>
                    <button
                        className="text-muted-foreground hover:text-foreground/80 text-xs underline ml-3"
                        onClick={() => setShowDiag(v => !v)}
                    >
                        {showDiag ? 'Скрыть' : 'Диагностика'}
                    </button>
                </div>
                {showDiag && <UpdateDiagnosticPanel appVersion={APP_VERSION} />}
            </div>
        );
    }
    if (upToDate) {
        return (
            <span className="text-emerald-400 text-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Актуальная версия
            </span>
        );
    }

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={handleCheck}
            disabled={status === 'checking'}
            className="h-8 border-border text-foreground/80 hover:bg-secondary hover:text-foreground"
        >
            {status === 'checking'
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Проверяется…</>
                : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Проверить обновление</>
            }
        </Button>
    );
}

function SettingsLoading() {
    return (
        <div className="min-h-screen bg-background p-6 flex items-center justify-center">
            <div className="text-muted-foreground">Загрузка настроек...</div>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={<SettingsLoading />}>
            <SettingsContent />
        </Suspense>
    );
}

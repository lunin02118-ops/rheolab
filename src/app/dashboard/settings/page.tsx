import { Suspense, lazy, Component, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Monitor, Moon, Sun, Languages, Database,
    BrainCircuit, Key,
    LayoutTemplate, Info, Settings as SettingsIcon,
    LineChart, FileText, AlertTriangle,
    Loader2
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useTheme } from '@/contexts/theme-context';
const ExpertSettingsPanel = lazy(() =>
    import('@/components/analysis/expert-settings-panel').then(m => ({ default: m.ExpertSettingsPanel })));
const APIKeyManager = lazy(() =>
    import('@/components/settings/APIKeyManager').then(m => ({ default: m.APIKeyManager })));
const BackupManager = lazy(() =>
    import('@/components/settings/BackupManager').then(m => ({ default: m.BackupManager })));
const ExperimentExportImport = lazy(() =>
    import('@/components/settings/ExperimentExportImport').then(m => ({ default: m.ExperimentExportImport })));
const BrandingManager = lazy(() =>
    import('@/components/settings/BrandingManager').then(m => ({ default: m.BrandingManager })));
const ChartSettingsManager = lazy(() =>
    import('@/components/settings/ChartSettingsManager').then(m => ({ default: m.ChartSettingsManager })));
const ReportSettingsManager = lazy(() =>
    import('@/components/settings/ReportSettingsManager').then(m => ({ default: m.ReportSettingsManager })));
const AppSettingsExporter = lazy(() =>
    import('@/components/settings/AppSettingsExporter').then(m => ({ default: m.AppSettingsExporter })));
const OperatorManager = lazy(() =>
    import('@/components/settings/OperatorManager').then(m => ({ default: m.OperatorManager })));
const LaboratoryManager = lazy(() =>
    import('@/components/settings/LaboratoryManager').then(m => ({ default: m.LaboratoryManager })));

function TabLoader() {
    return (
        <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
    );
}
import { APP_VERSION, BUILD_DATE, COMMIT_HASH } from '@/lib/version';
import { UpdateCheckButton } from './UpdateCheck';
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
                            <Suspense fallback={<TabLoader />}>
                                <OperatorManager />
                            </Suspense>
                        </SettingsErrorBoundary>

                        <SettingsErrorBoundary name="\u041b\u0430\u0431\u043e\u0440\u0430\u0442\u043e\u0440\u0438\u0438">
                            <Suspense fallback={<TabLoader />}>
                                <LaboratoryManager />
                            </Suspense>
                        </SettingsErrorBoundary>                    </TabsContent>

                    {/* === DATA TAB === */}
                    <TabsContent value="data" className="space-y-6">
                        <SettingsErrorBoundary name="Локальное хранилище">
                        <Suspense fallback={<TabLoader />}>
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
                        </Suspense>
                        </SettingsErrorBoundary>

                        <SettingsErrorBoundary name="Экспорт/Импорт">
                        <Suspense fallback={<TabLoader />}>
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
                        </Suspense>
                        </SettingsErrorBoundary>
                    </TabsContent>

                    {/* === ANALYSIS TAB === (expert mode only) */}
                    {isExpertMode && (
                    <TabsContent value="analysis" className="space-y-6">
                        <SettingsErrorBoundary name="Анализ">
                            <Suspense fallback={<TabLoader />}>
                                <ExpertSettingsPanel />
                            </Suspense>
                        </SettingsErrorBoundary>
                    </TabsContent>
                    )}

                    {/* === CHARTS TAB === */}
                    <TabsContent value="charts" className="space-y-6">
                        <SettingsErrorBoundary name="Графики">
                            <Suspense fallback={<TabLoader />}>
                                <ChartSettingsManager />
                            </Suspense>
                        </SettingsErrorBoundary>
                    </TabsContent>

                    {/* === REPORTS TAB === */}
                    <TabsContent value="reports" className="space-y-6">
                        <SettingsErrorBoundary name="Отчёты">
                            <Suspense fallback={<TabLoader />}>
                                <ReportSettingsManager />
                            </Suspense>
                        </SettingsErrorBoundary>
                        <SettingsErrorBoundary name="Брендинг">
                            <Suspense fallback={<TabLoader />}>
                                <BrandingManager />
                            </Suspense>
                        </SettingsErrorBoundary>
                    </TabsContent>

                    {/* === SYSTEM TAB === */}
                    <TabsContent value="system" className="space-y-6">
                        {/* Settings Export/Import */}
                        <SettingsErrorBoundary name="Система">
                        <Suspense fallback={<TabLoader />}>
                            <AppSettingsExporter />
                        </Suspense>

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
                                    <Suspense fallback={<TabLoader />}>
                                        <APIKeyManager />
                                    </Suspense>
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

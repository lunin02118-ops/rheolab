import { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Monitor,
    Database,
    BrainCircuit,
    User,
    Settings as SettingsIcon,
    LineChart,
    Ruler,
} from 'lucide-react';
import { useUIMode } from '@/contexts/ui-mode-context';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    AnalysisTab,
    ChartsTab,
    DataTab,
    DisplayTab,
    GeneralTab,
    ProfileTab,
} from './tabs';

// Accept legacy aliases so old bookmarks/links keep working.
const LEGACY_TAB_ALIASES: Record<string, string> = {
    general: 'general',
    profile: 'profile',
    data: 'data',          // kept (now includes former 'system')
    analysis: 'analysis',
    charts: 'charts',
    display: 'display',
    system: 'data',        // merged into Data & System
    reports: 'data',       // legacy: reports-ish settings live alongside data/system now
};
const VALID_TABS = ['general', 'display', 'profile', 'data', 'analysis', 'charts'];

function SettingsContent() {
    const { mode } = useUIMode();
    const [searchParams] = useSearchParams();
    const tabFromUrl = searchParams.get('tab');
    const requestedTab = tabFromUrl ? (LEGACY_TAB_ALIASES[tabFromUrl] ?? tabFromUrl) : null;
    const isExpertMode = mode === 'expert';
    const resolvedTab = requestedTab && VALID_TABS.includes(requestedTab) ? requestedTab : 'general';
    // In beginner mode, analysis tab is hidden — silently fall back to general.
    const defaultTab = !isExpertMode && resolvedTab === 'analysis' ? 'general' : resolvedTab;

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
                            <Monitor className="w-4 h-4" />
                            <span>Интерфейс</span>
                        </TabsTrigger>
                        <TabsTrigger value="display" className="flex items-center gap-2 py-3 data-[state=active]:bg-amber-600 data-[state=active]:text-white transition-colors">
                            <Ruler className="w-4 h-4" />
                            <span>Единицы</span>
                        </TabsTrigger>
                        <TabsTrigger value="profile" className="flex items-center gap-2 py-3 data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-colors">
                            <User className="w-4 h-4" />
                            <span>Профиль</span>
                        </TabsTrigger>
                        <TabsTrigger value="charts" className="flex items-center gap-2 py-3 data-[state=active]:bg-cyan-600 data-[state=active]:text-white transition-colors">
                            <LineChart className="w-4 h-4" />
                            <span>Графики</span>
                        </TabsTrigger>
                        {isExpertMode && (
                            <TabsTrigger value="analysis" className="flex items-center gap-2 py-3 data-[state=active]:bg-purple-600 data-[state=active]:text-white transition-colors">
                                <BrainCircuit className="w-4 h-4" />
                                <span>Анализ</span>
                            </TabsTrigger>
                        )}
                        <TabsTrigger value="data" className="flex items-center gap-2 py-3 data-[state=active]:bg-green-600 data-[state=active]:text-white transition-colors">
                            <Database className="w-4 h-4" />
                            <span>Данные и система</span>
                        </TabsTrigger>
                    </TabsList>

                    <GeneralTab />
                    <DisplayTab />
                    <ProfileTab />
                    <ChartsTab />
                    {isExpertMode && <AnalysisTab />}
                    <DataTab />
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

/**
 * General tab — interface mode, theme, and language selectors.
 */
import { Monitor, Moon, Sun, Languages } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useTheme } from '@/contexts/theme-context';

export function GeneralTab() {
    const { mode, setMode } = useUIMode();
    const { theme, setTheme } = useTheme();

    return (
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
        </TabsContent>
    );
}

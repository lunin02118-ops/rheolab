/**
 * Data & System tab — backup, export/import, API keys, settings export, and "about".
 */
import { Suspense } from 'react';
import { Database, Info, Key } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { APP_VERSION, BUILD_DATE, COMMIT_HASH } from '@/lib/version';
import { UpdateCheckButton } from '../UpdateCheck';
import { SettingsErrorBoundary, TabLoader } from './_shared';
import {
    APIKeyManager,
    AppSettingsExporter,
    BackupManager,
    ExperimentExportImport,
} from './lazy-components';

export function DataTab() {
    return (
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

            {/* —— Former «Система» content, merged here —— */}
            <SettingsErrorBoundary name="Экспорт настроек">
                <Suspense fallback={<TabLoader />}>
                    <AppSettingsExporter />
                </Suspense>
            </SettingsErrorBoundary>

            <SettingsErrorBoundary name="API Ключи">
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
            </SettingsErrorBoundary>

            <SettingsErrorBoundary name="О программе">
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
    );
}

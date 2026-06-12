/**
 * Data & System tab — backup, export/import, API keys, and settings export.
 */
import { Suspense } from 'react';
import { Database, Key } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
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
        </TabsContent>
    );
}

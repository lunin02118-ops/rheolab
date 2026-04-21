/**
 * Charts tab — line configurations and chart behaviour.
 */
import { Suspense } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { SettingsErrorBoundary, TabLoader } from './_shared';
import { ChartSettingsManager } from './lazy-components';

export function ChartsTab() {
    return (
        <TabsContent value="charts" className="space-y-6">
            <SettingsErrorBoundary name="Графики">
                <Suspense fallback={<TabLoader />}>
                    <ChartSettingsManager />
                </Suspense>
            </SettingsErrorBoundary>
        </TabsContent>
    );
}

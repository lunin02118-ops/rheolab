/**
 * Display tab — unit system and precision.
 */
import { Suspense } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { SettingsErrorBoundary, TabLoader } from './_shared';
import { PrecisionSettingsCard, UnitSystemCard } from './lazy-components';

export function DisplayTab() {
    return (
        <TabsContent value="display" className="space-y-6">
            <SettingsErrorBoundary name="Система единиц">
                <Suspense fallback={<TabLoader />}>
                    <UnitSystemCard />
                </Suspense>
            </SettingsErrorBoundary>
            <SettingsErrorBoundary name="Точность отображения">
                <Suspense fallback={<TabLoader />}>
                    <PrecisionSettingsCard />
                </Suspense>
            </SettingsErrorBoundary>
        </TabsContent>
    );
}

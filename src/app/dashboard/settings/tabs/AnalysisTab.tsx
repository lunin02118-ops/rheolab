/**
 * Analysis tab — expert-only settings panel.
 */
import { Suspense } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { SettingsErrorBoundary, TabLoader } from './_shared';
import { ExpertSettingsPanel } from './lazy-components';

export function AnalysisTab() {
    return (
        <TabsContent value="analysis" className="space-y-6">
            <SettingsErrorBoundary name="Анализ">
                <Suspense fallback={<TabLoader />}>
                    <ExpertSettingsPanel />
                </Suspense>
            </SettingsErrorBoundary>
        </TabsContent>
    );
}

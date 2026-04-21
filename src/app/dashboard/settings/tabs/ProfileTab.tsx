/**
 * Profile tab — operators, laboratories, and branding managers.
 */
import { Suspense } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { SettingsErrorBoundary, TabLoader } from './_shared';
import { BrandingManager, LaboratoryManager, OperatorManager } from './lazy-components';

export function ProfileTab() {
    return (
        <TabsContent value="profile" className="space-y-6">
            <SettingsErrorBoundary name="Операторы">
                <Suspense fallback={<TabLoader />}>
                    <OperatorManager />
                </Suspense>
            </SettingsErrorBoundary>

            <SettingsErrorBoundary name="Лаборатории">
                <Suspense fallback={<TabLoader />}>
                    <LaboratoryManager />
                </Suspense>
            </SettingsErrorBoundary>

            <SettingsErrorBoundary name="Брендинг">
                <Suspense fallback={<TabLoader />}>
                    <BrandingManager />
                </Suspense>
            </SettingsErrorBoundary>
        </TabsContent>
    );
}

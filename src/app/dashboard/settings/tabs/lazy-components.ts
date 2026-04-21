/**
 * Lazy imports for all settings-tab components — centralised so the main
 * page and the individual tab files stay small.
 */
import { lazy } from 'react';

export const ExpertSettingsPanel = lazy(() =>
    import('@/components/analysis/expert-settings-panel').then(m => ({ default: m.ExpertSettingsPanel })));
export const UnitSystemCard = lazy(() =>
    import('@/components/analysis/UnitSystemCard').then(m => ({ default: m.UnitSystemCard })));
export const APIKeyManager = lazy(() =>
    import('@/components/settings/APIKeyManager').then(m => ({ default: m.APIKeyManager })));
export const BackupManager = lazy(() =>
    import('@/components/settings/BackupManager').then(m => ({ default: m.BackupManager })));
export const ExperimentExportImport = lazy(() =>
    import('@/components/settings/ExperimentExportImport').then(m => ({ default: m.ExperimentExportImport })));
export const BrandingManager = lazy(() =>
    import('@/components/settings/BrandingManager').then(m => ({ default: m.BrandingManager })));
export const ChartSettingsManager = lazy(() =>
    import('@/components/settings/ChartSettingsManager').then(m => ({ default: m.ChartSettingsManager })));
export const PrecisionSettingsCard = lazy(() =>
    import('@/components/settings/PrecisionSettingsCard').then(m => ({ default: m.PrecisionSettingsCard })));
export const AppSettingsExporter = lazy(() =>
    import('@/components/settings/AppSettingsExporter').then(m => ({ default: m.AppSettingsExporter })));
export const OperatorManager = lazy(() =>
    import('@/components/settings/OperatorManager').then(m => ({ default: m.OperatorManager })));
export const LaboratoryManager = lazy(() =>
    import('@/components/settings/LaboratoryManager').then(m => ({ default: m.LaboratoryManager })));

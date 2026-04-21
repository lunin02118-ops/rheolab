import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BrandingState {
    companyName: string;
    companyLogo: string | null;
    showCalibration: boolean;
    showRawData: boolean;
    showRecipe: boolean;
    showWaterAnalysis: boolean;
    reportLanguage: 'ru' | 'en';
    setCompanyName: (name: string) => void;
    setCompanyLogo: (logo: string | null) => void;
    setShowCalibration: (show: boolean) => void;
    setShowRawData: (show: boolean) => void;
    setShowRecipe: (show: boolean) => void;
    setShowWaterAnalysis: (show: boolean) => void;
    setReportLanguage: (lang: 'ru' | 'en') => void;
}

export const useBrandingStore = create<BrandingState>()(
    persist(
        (set) => ({
            companyName: 'RheoLab Enterprise',
            companyLogo: null,
            showCalibration: false,
            showRawData: false,
            showRecipe: true,
            showWaterAnalysis: true,
            reportLanguage: 'ru',
            setCompanyName: (name) => set({ companyName: name }),
            setCompanyLogo: (logo) => set({ companyLogo: logo }),
            setShowCalibration: (show) => set({ showCalibration: show }),
            setShowRawData: (show) => set({ showRawData: show }),
            setShowRecipe: (show) => set({ showRecipe: show }),
            setShowWaterAnalysis: (show) => set({ showWaterAnalysis: show }),
            setReportLanguage: (lang) => set({ reportLanguage: lang }),
        }),
        {
            name: 'rheolab-branding-storage',
        }
    )
);

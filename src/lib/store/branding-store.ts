import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BrandingState {
    companyName: string;
    companyLogo: string | null;
    showCalibration: boolean;
    showRawData: boolean;
    setCompanyName: (name: string) => void;
    setCompanyLogo: (logo: string | null) => void;
    setShowCalibration: (show: boolean) => void;
    setShowRawData: (show: boolean) => void;
}

export const useBrandingStore = create<BrandingState>()(
    persist(
        (set) => ({
            companyName: 'RheoLab Enterprise',
            companyLogo: null,
            showCalibration: false,
            showRawData: false,
            setCompanyName: (name) => set({ companyName: name }),
            setCompanyLogo: (logo) => set({ companyLogo: logo }),
            setShowCalibration: (show) => set({ showCalibration: show }),
            setShowRawData: (show) => set({ showRawData: show }),
        }),
        {
            name: 'rheolab-branding-storage',
        }
    )
);

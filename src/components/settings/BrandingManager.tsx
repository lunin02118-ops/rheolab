import { Building2, Upload } from 'lucide-react';
import { useBrandingStore } from '@/lib/store/branding-store';
import { useShallow } from 'zustand/react/shallow';

export function BrandingManager() {
    const { companyName, companyLogo, setCompanyName, setCompanyLogo } = useBrandingStore(
        useShallow(s => ({ companyName: s.companyName, companyLogo: s.companyLogo, setCompanyName: s.setCompanyName, setCompanyLogo: s.setCompanyLogo }))
    );

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setCompanyLogo(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <section className="bg-card/50 border border-border rounded-xl p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-orange-400" />
                Брендинг отчетов
            </h2>
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Эти данные будут использоваться по умолчанию при генерации PDF и Excel отчетов.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm text-muted-foreground mb-2 block">Название компании</label>
                        <input
                            type="text"
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            placeholder="Название компании"
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-blue-500 outline-none transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-sm text-muted-foreground mb-2 block">Логотип</label>
                        <div className="relative">
                            <input
                                type="file"
                                id="settings-logo-upload"
                                accept="image/*"
                                onChange={handleLogoUpload}
                                className="hidden"
                            />
                            <label
                                htmlFor="settings-logo-upload"
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-background border border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-border cursor-pointer transition-colors h-[38px]"
                            >
                                {companyLogo ? (
                                    <img src={companyLogo} alt="Logo" className="h-5 object-contain" />
                                ) : (
                                    <>
                                        <Upload className="w-4 h-4" />
                                        Загрузить логотип
                                    </>
                                )}
                            </label>
                            {companyLogo && (
                                <button
                                    onClick={() => setCompanyLogo(null)}
                                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-foreground rounded-full text-[10px] flex items-center justify-center shadow-lg"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

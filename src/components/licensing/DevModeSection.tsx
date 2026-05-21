/**
 * Dev Mode Multi-License Section
 *
 * Компонент для управления несколькими лицензиями в режиме разработки.
 * Используется только в dev-сборке (!isProduction).
 */

import React, { useState, useCallback } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Bug, Trash2, Check, Shield, ShieldCheck } from 'lucide-react';
import {
    isDevModeEnabled,
    setDevMode,
    getAllSlots,
    getActiveSlot,
    setActiveSlot,
    removeLicenseSlot,
    type LicenseSlot,
} from '@/lib/licensing/multi-license-store';
import { useLicenseStore } from '@/lib/store/license-store';

interface DevModeSectionProps {
    licenseKey: string;
    isActivating: boolean;
    onKeyChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onActivate: () => void;
}

export function DevModeSection({
    licenseKey,
    isActivating,
    onKeyChange,
    onActivate,
}: DevModeSectionProps) {
    // Lazy-init from localStorage-backed helpers so we hydrate without an
    // effect round-trip.  `slots` / `activeSlotId` only have meaningful
    // values when dev-mode is on; otherwise they stay empty / null exactly
    // as they did with the explicit `if (devEnabled) refreshSlots()` guard.
    const [devMode, setDevModeState] = useState(isDevModeEnabled);
    const [slots, setSlots] = useState<LicenseSlot[]>(() =>
        isDevModeEnabled() ? getAllSlots() : [],
    );
    const [activeSlotId, setActiveSlotId] = useState<string | null>(() =>
        isDevModeEnabled() ? (getActiveSlot()?.id ?? null) : null,
    );
    const [removeConfirmSlotId, setRemoveConfirmSlotId] = useState<string | null>(null);

    const refreshSlots = useCallback(() => {
        const allSlots = getAllSlots();
        const active = getActiveSlot();
        setSlots(allSlots);
        setActiveSlotId(active?.id || null);
    }, []);

    // Mount hydration of dev-mode flag and slots is now lazy-init'd directly
    // in the useState declarations above (`devMode`, `slots`, `activeSlotId`),
    // so this useEffect — which only mirrored localStorage into React state —
    // is no longer needed.

    const handleToggleDevMode = () => {
        const newState = !devMode;
        setDevMode(newState);
        setDevModeState(newState);
        if (newState) refreshSlots();
    };

    const handleSwitchSlot = async (slotId: string) => {
        setActiveSlot(slotId);
        setActiveSlotId(slotId);
        await useLicenseStore.getState().refresh();
        setTimeout(() => window.location.reload(), 500);
    };

    const handleRemoveSlot = (slotId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setRemoveConfirmSlotId(slotId);
    };

    const confirmRemoveSlot = () => {
        if (!removeConfirmSlotId) return;
        const slotId = removeConfirmSlotId;
        setRemoveConfirmSlotId(null);
        removeLicenseSlot(slotId);
        refreshSlots();
        if (slotId === activeSlotId) {
            void useLicenseStore.getState().refresh().then(() => window.location.reload());
        }
    };

    const getLicenseIcon = (type: string) => {
        switch (type) {
            case 'corporate': return <ShieldCheck className="w-4 h-4 text-purple-400" />;
            case 'developer': return <Bug className="w-4 h-4 text-orange-400" />;
            default: return <Shield className="w-4 h-4 text-blue-400" />;
        }
    };

    return (
        <>
            <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-orange-400">
                        <Bug className="w-4 h-4" />
                        Режим разработчика
                    </div>
                    <button
                        onClick={handleToggleDevMode}
                        className={`relative w-10 h-5 rounded-full transition-colors ${devMode ? 'bg-orange-500' : 'bg-muted'}`}
                        role="switch"
                        aria-checked={devMode}
                        aria-label="Переключить режим разработчика"
                    >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${devMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                </div>

                {devMode && (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground mb-2">
                            Активируйте несколько лицензий для тестирования
                        </p>

                        {slots.length > 0 ? (
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                {slots.map(slot => (
                                    <div
                                        key={slot.id}
                                        onClick={() => handleSwitchSlot(slot.id)}
                                        className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${slot.id === activeSlotId
                                                ? 'bg-blue-500/20 border border-blue-500/30'
                                                : 'bg-muted/50 hover:bg-muted'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {getLicenseIcon(slot.license.type)}
                                            <div>
                                                <div className="text-sm font-medium">
                                                    {slot.label || slot.license.type}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {slot.key.substring(0, 9)}***
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {slot.id === activeSlotId && (
                                                <Check className="w-4 h-4 text-green-400" />
                                            )}
                                            <button
                                                onClick={(e) => handleRemoveSlot(slot.id, e)}
                                                className="p-1 hover:bg-red-500/20 rounded transition-colors"
                                                aria-label="Удалить лицензию"
                                            >
                                                <Trash2 className="w-3 h-3 text-red-400" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground text-center py-2">
                                Нет сохранённых лицензий
                            </p>
                        )}

                        <p className="text-xs text-muted-foreground mt-2">
                            Введите новый ключ ниже для добавления в список
                        </p>

                        <div className="space-y-2 mt-3 pt-3 border-t border-border">
                            <Input
                                placeholder="XXXX-XXXX-XXXX-XXXX"
                                value={licenseKey}
                                onChange={onKeyChange}
                                className="font-mono text-center tracking-wider text-sm"
                                disabled={isActivating}
                            />
                            <Button
                                onClick={onActivate}
                                disabled={isActivating || licenseKey.length < 19}
                                size="sm"
                                className="w-full"
                            >
                                {isActivating ? (
                                    <>
                                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                        Активация...
                                    </>
                                ) : (
                                    'Добавить лицензию'
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <AlertDialog open={!!removeConfirmSlotId} onOpenChange={open => { if (!open) setRemoveConfirmSlotId(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Удалить лицензию?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Лицензия будет удалена из списка сохранённых. Если это активная лицензия — приложение перезагрузится.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-500" onClick={confirmRemoveSlot}>
                            Удалить
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

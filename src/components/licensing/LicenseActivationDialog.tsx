/**
 * License Activation Dialog
 * 
 * Модальное окно для активации лицензии
 * Включает multi-license функционал для dev режима
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useLicense } from '@/hooks/useLicense';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Loader2, Key, CheckCircle, XCircle, Bug, Trash2, Check, Shield, ShieldCheck } from 'lucide-react';
import {
    isDevModeEnabled,
    setDevMode,
    getAllSlots,
    getActiveSlot,
    setActiveSlot,
    removeLicenseSlot,
    type LicenseSlot,
} from '@/lib/licensing/multi-license-store';
import { isProduction } from '@/lib/env';
import { useLicenseStore } from '@/lib/store/license-store';

interface LicenseActivationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    forceBlock?: boolean;
    blockMessage?: string;
}

export function LicenseActivationDialog({
    open,
    onOpenChange,
    forceBlock = false,
    blockMessage,
}: LicenseActivationDialogProps) {
    const { activate, result } = useLicense();

    const [licenseKey, setLicenseKey] = useState('');
    const [isActivating, setIsActivating] = useState(false);
    const [activationResult, setActivationResult] = useState<{
        success: boolean;
        message: string;
    } | null>(null);
    const [machineId, setMachineId] = useState<string>('');

    // Dev mode multi-license state
    const [devMode, setDevModeState] = useState(false);
    const [slots, setSlots] = useState<LicenseSlot[]>([]);
    const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
    const [removeConfirmSlotId, setRemoveConfirmSlotId] = useState<string | null>(null);

    // Load Machine ID and dev mode state
    useEffect(() => {
        if (!open) return;
        let cancelled = false;

        import('@/lib/licensing/tauri-bridge')
            .then(mod => mod.getServerMachineId())
            .then(id => { if (!cancelled) setMachineId(id); })
            .catch((_e) => { /* machine ID unavailable in web context — display omitted */ });

        // Load dev mode state (only in development)
        if (!isProduction) {
            const devEnabled = isDevModeEnabled();
            setDevModeState(devEnabled);
            if (devEnabled) {
                refreshSlots();
            }
        }

        return () => { cancelled = true; };
    }, [open]);

    const refreshSlots = () => {
        const allSlots = getAllSlots();
        const active = getActiveSlot();
        setSlots(allSlots);
        setActiveSlotId(active?.id || null);
    };

    // Toggle dev mode
    const handleToggleDevMode = () => {
        const newState = !devMode;
        setDevMode(newState);
        setDevModeState(newState);
        if (newState) {
            refreshSlots();
        }
    };

    // Switch active license slot
    const handleSwitchSlot = async (slotId: string) => {
        setActiveSlot(slotId);
        setActiveSlotId(slotId);
        await useLicenseStore.getState().refresh();
        setTimeout(() => window.location.reload(), 500);
    };

    // Remove license slot
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
            useLicenseStore.getState().refresh().then(() => window.location.reload());
        }
    };

    // Get license type icon
    const getLicenseIcon = (type: string) => {
        switch (type) {
            case 'enterprise': return <ShieldCheck className="w-4 h-4 text-purple-400" />;
            case 'developer': return <Bug className="w-4 h-4 text-orange-400" />;
            default: return <Shield className="w-4 h-4 text-blue-400" />;
        }
    };

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setLicenseKey('');
            setActivationResult(null);
        }
    }, [open]);

    // Форматирование ключа при вводе
    const handleKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Добавить дефисы
        if (value.length > 4) {
            value = value.slice(0, 4) + '-' + value.slice(4);
        }
        if (value.length > 9) {
            value = value.slice(0, 9) + '-' + value.slice(9);
        }
        if (value.length > 14) {
            value = value.slice(0, 14) + '-' + value.slice(14);
        }

        // Ограничить длину
        if (value.length <= 19) {
            setLicenseKey(value);
        }
    }, []);

    // Активация
    const handleActivate = async () => {
        if (licenseKey.length !== 19) {
            setActivationResult({
                success: false,
                message: 'Введите полный ключ в формате XXXX-XXXX-XXXX-XXXX',
            });
            return;
        }

        setIsActivating(true);
        setActivationResult(null);

        try {
            const result = await activate(licenseKey);
            setActivationResult(result);

            if (result.success) {
                // Перезагружаем страницу для гарантированного обновления UI
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            }
        } catch (_e) {
            setActivationResult({
                success: false,
                message: 'Ошибка активации. Попробуйте позже.',
            });
        } finally {
            setIsActivating(false);
        }
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Key className="h-5 w-5" />
                        Активация лицензии
                    </DialogTitle>
                    <DialogDescription>
                        Введите ключ лицензии для активации полной версии RheoLab Enterprise
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Детальная информация о лицензии или форма ввода */}
                    {result?.status === 'active' && result.license ? (
                        <div className="space-y-4">
                            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg space-y-3">
                                <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium pb-2 border-b border-green-500/20">
                                    <CheckCircle className="h-5 w-5" />
                                    Лицензия активна
                                </div>

                                <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                                    <span className="text-muted-foreground">Владелец:</span>
                                    <span className="font-medium">{result.license.customerName}</span>

                                    <span className="text-muted-foreground">Тип:</span>
                                    <span className="font-medium">
                                        {result.license.type === 'standard' ? 'Стандартная' :
                                            result.license.type === 'enterprise' ? 'Enterprise' : result.license.type}
                                    </span>

                                    <span className="text-muted-foreground">Истекает:</span>
                                    <span className="font-medium">
                                        {new Date(result.license.expiresAt).toLocaleDateString('ru-RU', {
                                            day: 'numeric', month: 'long', year: 'numeric'
                                        })}
                                    </span>

                                    {result.key && (
                                        <>
                                            <span className="text-muted-foreground">Ключ:</span>
                                            <span className="font-mono text-xs text-muted-foreground break-all">
                                                {result.key}
                                            </span>
                                        </>
                                    )}

                                    {result.license.machineId && (
                                        <>
                                            <span className="text-muted-foreground">ID устройства:</span>
                                            <span className="font-mono text-xs text-muted-foreground break-all">
                                                {result.license.machineId}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Dev Mode Multi-License Section */}
                            {!isProduction && (
                                <div className="border-t border-border pt-4 mt-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2 text-sm font-medium text-orange-400">
                                            <Bug className="w-4 h-4" />
                                            Режим разработчика
                                        </div>
                                        <button
                                            onClick={handleToggleDevMode}
                                            className={`relative w-10 h-5 rounded-full transition-colors ${devMode ? 'bg-orange-500' : 'bg-muted'
                                                }`}
                                            role="switch"
                                            aria-checked={devMode}
                                            aria-label="Переключить режим разработчика"
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${devMode ? 'translate-x-5' : 'translate-x-0.5'
                                                }`} />
                                        </button>
                                    </div>

                                    {devMode && (
                                        <div className="space-y-2">
                                            <p className="text-xs text-muted-foreground mb-2">
                                                Активируйте несколько лицензий для тестирования
                                            </p>

                                            {/* License Slots */}
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

                                            {/* Add new license hint */}
                                            <p className="text-xs text-muted-foreground mt-2">
                                                Введите новый ключ ниже для добавления в список
                                            </p>

                                            {/* Input for new license in dev mode */}
                                            <div className="space-y-2 mt-3 pt-3 border-t border-border">
                                                <Input
                                                    placeholder="XXXX-XXXX-XXXX-XXXX"
                                                    value={licenseKey}
                                                    onChange={handleKeyChange}
                                                    className="font-mono text-center tracking-wider text-sm"
                                                    disabled={isActivating}
                                                />
                                                <Button
                                                    onClick={handleActivate}
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
                            )}

                        </div>
                    ) : (
                        <>
                            {/* Текущий статус (для Demo/Expired/Invalid) */}
                            {(result || blockMessage) && (
                                <div className={`p-3 rounded-md text-sm mb-4 ${(result?.status === 'invalid' || result?.status === 'demo_expired' || blockMessage)
                                    ? 'bg-destructive/15 text-destructive border border-destructive/20'
                                    : 'bg-muted text-muted-foreground'
                                    }`}>
                                    <div className="font-semibold mb-1">Статус лицензии:</div>
                                    <div className="font-medium">
                                        {blockMessage || result?.message}
                                    </div>
                                </div>
                            )}

                            {/* Поле ввода ключа */}
                            <div className="space-y-2">
                                <Label htmlFor="license-key">Ключ лицензии</Label>
                                <Input
                                    id="license-key"
                                    placeholder="XXXX-XXXX-XXXX-XXXX"
                                    value={licenseKey}
                                    onChange={handleKeyChange}
                                    className="font-mono text-center tracking-wider"
                                    disabled={isActivating}
                                />
                                {/* Display Machine ID */}
                                <div className="text-xs text-center text-muted-foreground pt-1">
                                    ID устройства: <span className="font-mono select-all text-foreground/70">{machineId || 'загрузка...'}</span>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Результат активации */}
                    {activationResult && (
                        <div className={`
              flex items-center gap-2 p-3 rounded-md text-sm
              ${activationResult.success
                                ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                                : 'bg-red-500/10 text-red-700 dark:text-red-300'
                            }
            `}>
                            {activationResult.success ? (
                                <CheckCircle className="h-4 w-4" />
                            ) : (
                                <XCircle className="h-4 w-4" />
                            )}
                            {activationResult.message}
                        </div>
                    )}

                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                    {!forceBlock && (
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isActivating}
                        >
                            {result?.status === 'active' ? 'Закрыть' : 'Отмена'}
                        </Button>
                    )}
                    {result?.status !== 'active' && (
                        <Button
                            onClick={handleActivate}
                            disabled={isActivating || licenseKey.length < 19}
                        >
                            {isActivating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Активация...
                                </>
                            ) : (
                                'Активировать'
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>

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

export default LicenseActivationDialog;

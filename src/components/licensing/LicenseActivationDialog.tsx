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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Key, CheckCircle, XCircle, Copy } from 'lucide-react';
import { DevModeSection } from './DevModeSection';
import { isProduction } from '@/lib/env';

interface LicenseActivationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    forceBlock?: boolean;
    blockMessage?: string;
}

interface LicenseActivationPanelProps {
    forceBlock?: boolean;
    blockMessage?: string;
    onClose?: () => void;
    active?: boolean;
}

function formatLicenseType(type: string) {
    switch (type) {
        case 'demo':
            return 'Пробная';
        case 'corporate':
            return 'Корпоративная';
        case 'trial':
            return 'Пробная';
        case 'developer':
            return 'Developer';
        case 'superuser':
            return 'Superuser';
        default:
            return type;
    }
}

export function LicenseActivationPanel({
    forceBlock = false,
    blockMessage,
    onClose,
    active = true,
}: LicenseActivationPanelProps) {
    const { activate, activateOffline, createOfflineActivationRequest, result } = useLicense();

    const [licenseKey, setLicenseKey] = useState('');
    const [activationMode, setActivationMode] = useState<'online' | 'offline'>('online');
    const [offlineRequestCode, setOfflineRequestCode] = useState('');
    const [offlineActivationCode, setOfflineActivationCode] = useState('');
    const [isActivating, setIsActivating] = useState(false);
    const [isGeneratingOfflineRequest, setIsGeneratingOfflineRequest] = useState(false);
    const [activationResult, setActivationResult] = useState<{
        success: boolean;
        message: string;
    } | null>(null);
    const [machineId, setMachineId] = useState<string>('');

    // Load Machine ID
    useEffect(() => {
        if (!active) return;
        let cancelled = false;

        import('@/lib/licensing/tauri-bridge')
            .then(mod => mod.getServerMachineId())
            .then(id => { if (!cancelled) setMachineId(id); })
            .catch((_e) => { /* machine ID unavailable in web context — display omitted */ });

        return () => { cancelled = true; };
    }, [active]);

    // Reset state when panel becomes active — React 19 "adjusting state on prop
    // change during render" pattern.  We only reset on the false→true
    // transition, preserving previous dialog behaviour exactly.
    const [prevActive, setPrevActive] = useState(active);
    if (prevActive !== active) {
        setPrevActive(active);
        if (active) {
            setLicenseKey('');
            setActivationMode('online');
            setOfflineRequestCode('');
            setOfflineActivationCode('');
            setActivationResult(null);
        }
    }

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

    const handleGenerateOfflineRequest = async () => {
        setIsGeneratingOfflineRequest(true);
        setActivationResult(null);
        try {
            const request = await createOfflineActivationRequest();
            setOfflineRequestCode(request.requestCode);
        } catch (_e) {
            setActivationResult({
                success: false,
                message: 'Не удалось сформировать код запроса.',
            });
        } finally {
            setIsGeneratingOfflineRequest(false);
        }
    };

    const handleCopyOfflineRequest = async () => {
        if (!offlineRequestCode) return;
        try {
            await navigator.clipboard.writeText(offlineRequestCode);
            setActivationResult({ success: true, message: 'Код запроса скопирован' });
        } catch (_e) {
            setActivationResult({ success: false, message: 'Не удалось скопировать код' });
        }
    };

    const handleActivateOffline = async () => {
        if (!offlineActivationCode.trim()) {
            setActivationResult({
                success: false,
                message: 'Вставьте офлайн-ключ активации.',
            });
            return;
        }

        setIsActivating(true);
        setActivationResult(null);
        try {
            const result = await activateOffline(offlineActivationCode.trim());
            setActivationResult(result);
            if (result.success) {
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            }
        } catch (_e) {
            setActivationResult({
                success: false,
                message: 'Ошибка офлайн-активации.',
            });
        } finally {
            setIsActivating(false);
        }
    };

    return (
        <>
                <div className="space-y-4 py-2">
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
                                        {formatLicenseType(result.license.type)}
                                    </span>

                                    <span className="text-muted-foreground">Срок:</span>
                                    <span className="font-medium">
                                        {result.license.expiresAt
                                            ? result.license.expiresAt.toLocaleDateString('ru-RU', {
                                                day: 'numeric', month: 'long', year: 'numeric'
                                            })
                                            : 'Постоянная'}
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
                                <DevModeSection
                                    licenseKey={licenseKey}
                                    isActivating={isActivating}
                                    onKeyChange={handleKeyChange}
                                    onActivate={handleActivate}
                                />
                            )}

                        </div>
                    ) : (
                        <>
                            {/* Текущий статус */}
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

                            <Tabs value={activationMode} onValueChange={value => setActivationMode(value as 'online' | 'offline')}>
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="online">Онлайн</TabsTrigger>
                                    <TabsTrigger value="offline">Офлайн Corporate</TabsTrigger>
                                </TabsList>
                                <TabsContent value="online" className="space-y-2 pt-2">
                                    <Label htmlFor="license-key">Ключ лицензии</Label>
                                    <Input
                                        id="license-key"
                                        placeholder="XXXX-XXXX-XXXX-XXXX"
                                        value={licenseKey}
                                        onChange={handleKeyChange}
                                        className="font-mono text-center tracking-wider"
                                        disabled={isActivating}
                                    />
                                    <div className="text-xs text-center text-muted-foreground pt-1">
                                        ID устройства: <span className="font-mono select-all text-foreground/70">{machineId || 'загрузка...'}</span>
                                    </div>
                                </TabsContent>
                                <TabsContent value="offline" className="space-y-3 pt-2">
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleGenerateOfflineRequest}
                                            disabled={isGeneratingOfflineRequest}
                                        >
                                            {isGeneratingOfflineRequest && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Сформировать код
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={handleCopyOfflineRequest}
                                            disabled={!offlineRequestCode}
                                            title="Скопировать код запроса"
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <textarea
                                        readOnly
                                        value={offlineRequestCode}
                                        placeholder="Код запроса появится здесь"
                                        className="min-h-[88px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    />
                                    <div className="space-y-2">
                                        <Label htmlFor="offline-activation-code">Офлайн-ключ активации</Label>
                                        <textarea
                                            id="offline-activation-code"
                                            value={offlineActivationCode}
                                            onChange={e => setOfflineActivationCode(e.target.value)}
                                            placeholder="RL-ACT1:..."
                                            className="min-h-[96px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            disabled={isActivating}
                                        />
                                    </div>
                                </TabsContent>
                            </Tabs>
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
                            onClick={onClose}
                            disabled={isActivating}
                        >
                            {result?.status === 'active' ? 'Закрыть' : 'Отмена'}
                        </Button>
                    )}
                    {result?.status !== 'active' && activationMode === 'online' && (
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
                    {result?.status !== 'active' && activationMode === 'offline' && (
                        <Button
                            onClick={handleActivateOffline}
                            disabled={isActivating || !offlineActivationCode.trim()}
                        >
                            {isActivating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Активация...
                                </>
                            ) : (
                                'Активировать офлайн'
                            )}
                        </Button>
                    )}
                </DialogFooter>

        </>
    );
}

export function LicenseActivationDialog({
    open,
    onOpenChange,
    forceBlock = false,
    blockMessage,
}: LicenseActivationDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Key className="h-5 w-5" />
                        Активация лицензии
                    </DialogTitle>
                    <DialogDescription>
                        Введите ключ лицензии для активации RheoLab
                    </DialogDescription>
                </DialogHeader>

                <LicenseActivationPanel
                    forceBlock={forceBlock}
                    blockMessage={blockMessage}
                    onClose={() => onOpenChange(false)}
                    active={open}
                />
            </DialogContent>
        </Dialog>
    );
}

export default LicenseActivationDialog;

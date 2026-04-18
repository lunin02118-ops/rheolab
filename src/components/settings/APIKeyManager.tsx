import { logger as clientLogger } from '@/lib/client-logger';

import React, { useState, useEffect } from 'react';
import { Key, Plus, Trash2, CheckCircle2, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useShallow } from 'zustand/react/shallow';
import {
    createApiKey,
    deleteApiKey,
    listApiKeys,
    setApiKeyActive,
    validateApiKey,
} from '@/lib/api-keys/client';
import type { ApiKeyRecord } from '@/types/tauri';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function APIKeyManager() {
    const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyValue, setNewKeyValue] = useState('');
    const [isValidating, setIsValidating] = useState(false);

    // Local state to track keys that have been deleted but might still be in the fetched list
    const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
    const [opError, setOpError] = useState<string | null>(null);
    const [opSuccess, setOpSuccess] = useState<string | null>(null);

    const { expertSettings, setExpertSettings } = useAnalysisSettingsStore(
        useShallow(s => ({ expertSettings: s.expertSettings, setExpertSettings: s.setExpertSettings }))
    );
    const selectedModel = expertSettings.aiModel;

    const fetchKeys = async () => {
        setIsLoading(true);
        try {
            const data = await listApiKeys();
            setKeys(Array.isArray(data) ? data : []);
        } catch (err) {
            clientLogger.error('Failed to fetch keys:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void fetchKeys();
    }, []);

    const handleModelChange = (model: string) => {
        setExpertSettings({ aiModel: model });
    };

    const handleAdd = async () => {
        if (!newKeyName || !newKeyValue) return;

        setIsValidating(true);
        try {
            // Validate first
            const validation = await validateApiKey(newKeyValue, 'groq');
            if (!validation.isValid) {
                setOpError(`Ошибка валидации ключа: ${validation.error}`);
                setIsValidating(false);
                return;
            }

            const result = await createApiKey({
                name: newKeyName,
                key: newKeyValue,
                provider: 'groq',
            });
            if (result.success) {
                setNewKeyName('');
                setNewKeyValue('');
                setIsAdding(false);
                await fetchKeys();
                setOpSuccess('Ключ успешно добавлен и проверен!');
            } else {
                setOpError(`Ошибка сохранения ключа: ${result.error || 'Неизвестная ошибка'}`);
            }
        } catch (err) {
            clientLogger.error('Failed to add key:', err);
            setOpError('Ошибка сети при добавлении ключа');
        } finally {
            setIsValidating(false);
        }
    };

    const handleToggle = async (id: string) => {
        try {
            const result = await setApiKeyActive(id);
            if (result.success) {
                await fetchKeys();
            } else {
                setOpError(`Ошибка переключения ключа: ${result.error || 'Неизвестная ошибка'}`);
            }
        } catch (err) {
            clientLogger.error('Failed to toggle key:', err);
        }
    };

    const handleDeleteClick = (id: string) => {
        setKeyToDelete(id);
    };

    const confirmDelete = async () => {
        if (!keyToDelete) return;

        const id = keyToDelete;
        setKeyToDelete(null);
        setDeletingId(id);

        try {
            const result = await deleteApiKey(id);
            if (result.success) {
                // Immediately hide the key using the set
                setDeletedKeys(prev => {
                    const next = new Set(prev);
                    next.add(id);
                    return next;
                });

                // Also update the main list to keep it clean
                setKeys(prev => prev.filter(k => k.id !== id));
            } else {
                setOpError(`Ошибка удаления: ${result.error || 'Неизвестная ошибка'}`);
            }
        } catch (err) {
            clientLogger.error('Delete error:', err);
            setOpError('Ошибка сети при удалении');
        } finally {
            setDeletingId(null);
        }
    };

    // Filter out keys that are marked as deleted locally
    const visibleKeys = keys.filter(k => !deletedKeys.has(k.id));

    return (
        <section className="bg-card/50 border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Key className="w-5 h-5 text-yellow-400" />
                    API Ключи & Модель
                </h2>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAdding(!isAdding)}
                    className="border-border hover:bg-secondary text-foreground/80"
                >
                    <Plus className="w-4 h-4 mr-2" />
                    Добавить
                </Button>
            </div>

            {/* Operation feedback */}
            {opError && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{opError}</span>
                    <button type="button" onClick={() => setOpError(null)} className="ml-auto text-red-400/60 hover:text-red-400">✕</button>
                </div>
            )}
            {opSuccess && (
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-2 text-green-400 text-sm">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>{opSuccess}</span>
                    <button type="button" onClick={() => setOpSuccess(null)} className="ml-auto text-green-400/60 hover:text-green-400">✕</button>
                </div>
            )}

            {/* Model Selection */}
            <div className="mb-6 p-4 bg-secondary/30 rounded-lg border border-border/50">
                <label className="text-xs font-medium text-muted-foreground mb-2 block">AI Модель</label>
                <select
                    value={selectedModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-yellow-500/50 outline-none"
                >
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Versatile)</option>
                    <option value="meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout (Fast)</option>
                </select>
            </div>

            {isAdding && (
                <Card className="bg-secondary/50 border-border p-4 mb-6 animate-in fade-in slide-in-from-top-2">
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <label className="text-xs font-medium text-muted-foreground">Название ключа (например, "Рабочий")</label>
                            <Input
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                placeholder="Введите название..."
                                className="bg-card border-border text-foreground"
                            />
                        </div>
                        <div className="grid gap-2">
                            <label className="text-xs font-medium text-muted-foreground">API Ключ (gsk_...)</label>
                            <Input
                                value={newKeyValue}
                                onChange={(e) => setNewKeyValue(e.target.value)}
                                placeholder="gsk_..."
                                type="password"
                                className="bg-card border-border text-foreground"
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>Отмена</Button>
                            <Button
                                size="sm"
                                onClick={handleAdd}
                                disabled={isValidating}
                                className="bg-yellow-600 hover:bg-yellow-500 text-foreground"
                            >
                                {isValidating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Сохранить
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            <div className="grid gap-3">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                    </div>
                ) : visibleKeys.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-border rounded-lg">
                        <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">Нет добавленных ключей</p>
                    </div>
                ) : (
                    visibleKeys.map((key) => (
                        <div
                            key={key.id}
                            className={`p-4 rounded-lg border transition-colors flex items-center justify-between ${key.isActive
                                ? 'bg-yellow-600/10 border-yellow-500/50'
                                : 'bg-secondary/30 border-border'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                <button
                                    type="button"
                                    onClick={() => handleToggle(key.id)}
                                    aria-pressed={key.isActive}
                                    aria-label={key.isActive ? 'Деактивировать ключ' : 'Активировать ключ'}
                                    className={`transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded ${key.isActive ? 'text-yellow-400' : 'text-muted-foreground hover:text-muted-foreground'}`}
                                >
                                    <CheckCircle2 className="w-5 h-5" />
                                </button>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-foreground">{key.name}</span>
                                        {key.isActive && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                                                АКТИВЕН
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="text-xs text-muted-foreground font-mono">
                                            {key.key}
                                        </code>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteClick(key.id)}
                                    disabled={deletingId === key.id}
                                    className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {deletingId === key.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Trash2 className="w-4 h-4" />
                                    )}
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="mt-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg flex gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Ключи хранятся локально в защищённом виде и не отображаются в интерфейсе в открытом тексте.
                    Они используются только для валидации и AI-запросов в рамках вашего окружения.
                </p>
            </div>

            <AlertDialog open={!!keyToDelete} onOpenChange={(open) => !open && setKeyToDelete(null)}>
                <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-foreground">Удалить API ключ?</AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground">
                            Это действие нельзя отменить. Ключ будет безвозвратно удален из базы данных.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-border text-foreground/80 hover:bg-secondary hover:text-foreground">
                            Отмена
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="bg-red-600 hover:bg-red-700 text-foreground border-none"
                        >
                            Удалить
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section >
    );
}

/**
 * Trial Banner
 * 
 * Баннер для пользователей в Demo режиме
 */

import React, { useState } from 'react';
import { useLicense } from '@/hooks/useLicense';
import { DEMO_LIMITS } from '@/lib/licensing';
import { X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TrialBannerProps {
    onActivate?: () => void;
}

export function TrialBanner({ onActivate }: TrialBannerProps) {
    const { isDemo, daysRemaining, experimentsRemaining } = useLicense();

    // Check if banner was dismissed today (lazy initial state)
    const [dismissed, setDismissed] = useState(() => {
        if (typeof window === 'undefined') return false;
        const dismissedDate = localStorage.getItem('trial_banner_dismissed');
        if (dismissedDate) {
            const date = new Date(dismissedDate);
            const today = new Date();
            return date.toDateString() === today.toDateString();
        }
        return false;
    });

    // Не показывать если не Demo или скрыт
    if (!isDemo || dismissed) {
        return null;
    }

    const handleDismiss = () => {
        setDismissed(true);
        localStorage.setItem('trial_banner_dismissed', new Date().toISOString());
    };

    const isUrgent = daysRemaining <= 7 || experimentsRemaining <= 5;

    return (
        <div className={`
      relative flex items-center justify-between px-4 py-2 text-sm
      ${isUrgent
                ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-b border-orange-500/20'
                : 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-b border-blue-500/20'
            }
    `}>
            <div className="flex items-center gap-3">
                <Zap className="h-4 w-4" />
                <span>
                    <strong>Пробная версия:</strong>{' '}
                    {daysRemaining} дней и {experimentsRemaining} экспериментов осталось
                    <span className="opacity-50 ml-2 text-xs">(В базе: {DEMO_LIMITS.maxExperiments - experimentsRemaining})</span>
                </span>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onActivate}
                >
                    Активировать полную версию
                </Button>

                <button
                    onClick={() => window.location.reload()}
                    className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded mr-1"
                    title="Обновить данные"
                >
                    ↻
                </button>

                <button
                    onClick={handleDismiss}
                    className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded"
                    title="Скрыть на сегодня"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

export default TrialBanner;

/**
 * License Status Badge
 * 
 * Показывает текущий статус лицензии в header
 */

import React from 'react';
import { useLicense } from '@/hooks/useLicense';
import { cn } from '@/lib/utils';
import { Shield, ShieldAlert, ShieldCheck, ShieldX, Loader2 } from 'lucide-react';

interface LicenseStatusBadgeProps {
    className?: string;
    onClick?: () => void;
}

export function LicenseStatusBadge({ className, onClick }: LicenseStatusBadgeProps) {
    const { status, isLoading, daysRemaining } = useLicense();

    if (isLoading) {
        return (
            <div className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-muted-foreground text-xs',
                className
            )}>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Проверка...</span>
            </div>
        );
    }

    const config = getStatusConfig(status, daysRemaining);

    return (
        <button
            onClick={onClick}
            className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                'hover:opacity-80 cursor-pointer',
                config.bgColor,
                config.textColor,
                className
            )}
            title={config.tooltip}
        >
            <config.icon className="h-3 w-3" />
            <span>{config.label}</span>
            {daysRemaining > 0 && status !== 'active' && (
                <span className="opacity-75">({daysRemaining}д)</span>
            )}
        </button>
    );
}

function getStatusConfig(
    status: string,
    daysRemaining: number,
) {
    switch (status) {
        case 'active':
            return {
                label: 'Лицензия',
                icon: ShieldCheck,
                bgColor: 'bg-green-500/10',
                textColor: 'text-green-600 dark:text-green-400',
                tooltip: 'Полная лицензия активна',
            };
        case 'grace':
            return {
                label: 'Грейс-период',
                icon: Shield,
                bgColor: 'bg-yellow-500/10',
                textColor: 'text-yellow-600 dark:text-yellow-400',
                tooltip: `Осталось ${daysRemaining} дней.`,
            };
        case 'demo':
            return {
                label: 'ДЕМО',
                icon: ShieldAlert,
                bgColor: 'bg-blue-500/10',
                textColor: 'text-blue-600 dark:text-blue-400',
                tooltip: `Пробный период: ${daysRemaining} дней осталось`,
            };
        case 'demo_expired':
        case 'expired':
            return {
                label: 'Истёк',
                icon: ShieldX,
                bgColor: 'bg-red-500/10',
                textColor: 'text-red-600 dark:text-red-400',
                tooltip: 'Срок лицензии истёк. Активируйте ключ.',
            };
        default:
            return {
                label: 'Не активна',
                icon: ShieldX,
                bgColor: 'bg-gray-500/10',
                textColor: 'text-gray-600 dark:text-gray-400',
                tooltip: 'Лицензия не активирована',
            };
    }
}

export default LicenseStatusBadge;

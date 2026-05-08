import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Check, Loader2 } from 'lucide-react';
import { logger } from '@/lib/logger';

interface TouchPointBackfillPayload {
    processed?: number;
    skipped?: number;
    iterations?: number;
    hasMore?: boolean;
    elapsedMs?: number;
}

interface NoticeState {
    visible: boolean;
    complete: boolean;
    processed: number;
    skipped: number;
    hasMore: boolean;
}

const EMPTY_NOTICE: NoticeState = {
    visible: false,
    complete: false,
    processed: 0,
    skipped: 0,
    hasMore: false,
};

function normalizePayload(payload: TouchPointBackfillPayload | undefined): Omit<NoticeState, 'visible' | 'complete'> {
    return {
        processed: Math.max(0, Number(payload?.processed ?? 0)),
        skipped: Math.max(0, Number(payload?.skipped ?? 0)),
        hasMore: Boolean(payload?.hasMore),
    };
}

export function DatabaseMaintenanceNotice() {
    const [notice, setNotice] = useState<NoticeState>(EMPTY_NOTICE);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        let cancelled = false;

        const clearHideTimer = () => {
            if (hideTimerRef.current) {
                clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
        };

        const showActive = (payload?: TouchPointBackfillPayload) => {
            clearHideTimer();
            const next = normalizePayload(payload);
            setNotice({
                ...next,
                visible: true,
                complete: false,
            });
        };

        const showComplete = (payload?: TouchPointBackfillPayload) => {
            const next = normalizePayload(payload);
            if (next.processed + next.skipped === 0) {
                setNotice(EMPTY_NOTICE);
                return;
            }
            setNotice({
                ...next,
                visible: true,
                complete: true,
            });
            clearHideTimer();
            hideTimerRef.current = setTimeout(() => {
                setNotice(EMPTY_NOTICE);
                hideTimerRef.current = null;
            }, 4500);
        };

        const subscriptions = Promise.all([
            listen<TouchPointBackfillPayload>('touch_point_backfill_started', ({ payload }) => {
                if (!cancelled) showActive(payload);
            }),
            listen<TouchPointBackfillPayload>('touch_point_backfill_progress', ({ payload }) => {
                if (!cancelled) showActive(payload);
            }),
            listen<TouchPointBackfillPayload>('touch_point_backfill_complete', ({ payload }) => {
                if (!cancelled) showComplete(payload);
            }),
        ]).catch((error) => {
            logger.warn(`DatabaseMaintenanceNotice: failed to subscribe to backfill events: ${String(error)}`);
            return [];
        });

        return () => {
            cancelled = true;
            clearHideTimer();
            void subscriptions.then((unlisteners) => {
                for (const unlisten of unlisteners) unlisten();
            });
        };
    }, []);

    if (!notice.visible) return null;

    const total = notice.processed + notice.skipped;
    const title = notice.complete ? 'Обновление базы данных завершено' : 'Обновление базы данных';
    const details = notice.complete
        ? notice.hasMore
            ? 'Остальные записи обновятся фоном при следующих запусках.'
            : 'Индексы и служебные расчеты готовы.'
        : 'Можно продолжать работу, процесс идет в фоне.';

    return (
        <div
            className="fixed top-20 right-4 z-[9998] w-[min(22rem,calc(100vw-2rem))] pointer-events-none"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-start gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 text-foreground shadow-lg backdrop-blur">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
                    {notice.complete ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-medium leading-5">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{details}</p>
                    {total > 0 ? (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Обработано записей: {total}
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

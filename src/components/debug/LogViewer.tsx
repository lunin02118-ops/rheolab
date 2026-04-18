import React, { useEffect, useRef } from 'react';
import { useLogStore, initializeLogStore } from '@/lib/store/log-store';
import { useShallow } from 'zustand/react/shallow';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
    Trash2,
    Terminal,
    ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LogLevel } from '@/lib/logger';

export function LogViewer() {
    const {
        logs,
        isOpen,
        toggleOpen,
        clearLogs,
        filterLevel,
        setFilterLevel,
        filterModule,
        setFilterModule
    } = useLogStore(useShallow(s => ({
        logs: s.logs,
        isOpen: s.isOpen,
        toggleOpen: s.toggleOpen,
        clearLogs: s.clearLogs,
        filterLevel: s.filterLevel,
        setFilterLevel: s.setFilterLevel,
        filterModule: s.filterModule,
        setFilterModule: s.setFilterModule,
    })));

    const scrollRef = useRef<HTMLDivElement>(null);

    // Initialize store on mount
    useEffect(() => {
        initializeLogStore();
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        if (isOpen && scrollRef.current) {
            const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }
    }, [logs, isOpen]);

    const filteredLogs = logs.filter(log => {
        if (filterLevel !== 'ALL') {
            const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
            const filterIdx = levels.indexOf(filterLevel);
            const logIdx = levels.indexOf(log.level);
            if (logIdx < filterIdx) return false;
        }
        if (filterModule && log.module !== filterModule) return false;
        return true;
    });

    const uniqueModules = Array.from(new Set(logs.map(l => l.module))).sort();

    if (!isOpen) {
        return (
            <Button
                variant="outline"
                size="icon"
                className="fixed bottom-4 right-4 z-50 h-10 w-10 rounded-full shadow-lg bg-background border-primary/20 hover:border-primary"
                onClick={toggleOpen}
                title="Открыть консоль отладки"
                aria-label="Открыть консоль отладки"
            >
                <Terminal className="h-5 w-5" />
            </Button>
        );
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 h-[300px] bg-background border-t shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">Системные логи</span>
                    <span className="text-xs text-muted-foreground ml-2">
                        ({filteredLogs.length} / {logs.length})
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {/* Level Filter */}
                    <select
                        className="h-7 text-xs border rounded px-2 bg-background"
                        value={filterLevel}
                        onChange={(e) => setFilterLevel(e.target.value as LogLevel | 'ALL')}
                    >
                        <option value="ALL">Все уровни</option>
                        <option value="DEBUG">Отладка+</option>
                        <option value="INFO">Инфо+</option>
                        <option value="WARN">Предупр.+</option>
                        <option value="ERROR">Ошибки</option>
                    </select>

                    {/* Module Filter */}
                    <select
                        className="h-7 text-xs border rounded px-2 bg-background max-w-[150px]"
                        value={filterModule || ''}
                        onChange={(e) => setFilterModule(e.target.value || null)}
                    >
                        <option value="">Все модули</option>
                        {uniqueModules.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>

                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearLogs} title="Очистить логи" aria-label="Очистить логи">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleOpen} title="Закрыть" aria-label="Закрыть консоль">
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Log Content */}
            <ScrollArea className="flex-1 p-4 font-mono text-xs" ref={scrollRef}>
                <div className="space-y-1">
                    {filteredLogs.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className="flex items-start gap-2 hover:bg-muted/50 p-0.5 rounded">
                            <span className="text-muted-foreground min-w-[70px]">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className={cn(
                                "font-bold min-w-[50px]",
                                log.level === 'DEBUG' && "text-muted-foreground",
                                log.level === 'INFO' && "text-blue-500",
                                log.level === 'WARN' && "text-yellow-500",
                                log.level === 'ERROR' && "text-red-500"
                            )}>
                                {log.level}
                            </span>
                            <span className="font-semibold text-primary/80 min-w-[120px] truncate" title={log.module}>
                                [{log.module}]
                            </span>
                            <span className="whitespace-pre-wrap break-all text-foreground/90">
                                {log.message}
                            </span>
                        </div>
                    ))}
                    {filteredLogs.length === 0 && (
                        <div className="text-center text-muted-foreground py-8">
                            Логи не найдены по заданным фильтрам.
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}

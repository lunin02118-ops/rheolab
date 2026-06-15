import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RefreshCw,
} from 'lucide-react';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { getRawTablePageById } from '@/lib/experiments/client';
import type { RawTablePage } from '@/types/tauri';

interface RawDataTableByIdProps {
    experimentId: string;
    pageSize?: number;
}

export const RawDataTableById = memo(function RawDataTableById({
    experimentId,
    pageSize = 25,
}: RawDataTableByIdProps) {
    const [currentPage, setCurrentPage] = useState(1);
    const [pageData, setPageData] = useState<RawTablePage | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const requestSeq = useRef(0);
    const precision = useChartSettingsStore(s => s.settings.precision);

    useEffect(() => {
        setCurrentPage(1);
    }, [experimentId, pageSize]);

    useEffect(() => {
        let isActive = true;
        const seq = requestSeq.current + 1;
        requestSeq.current = seq;
        setIsLoading(true);
        setError(null);

        getRawTablePageById(experimentId, currentPage, pageSize)
            .then(response => {
                if (!isActive || requestSeq.current !== seq) return;
                if (!response.success || !response.page) {
                    setPageData(null);
                    setError(response.error ?? 'Не удалось загрузить страницу данных');
                    return;
                }
                setPageData(response.page);
            })
            .catch(err => {
                if (!isActive || requestSeq.current !== seq) return;
                const message = err instanceof Error ? err.message : String(err);
                setPageData(null);
                setError(message || 'Не удалось загрузить страницу данных');
            })
            .finally(() => {
                if (isActive && requestSeq.current === seq) {
                    setIsLoading(false);
                }
            });

        return () => {
            isActive = false;
        };
    }, [experimentId, currentPage, pageSize, reloadToken]);

    const totalPages = pageData?.totalPages ?? 1;
    const totalRows = pageData?.totalRows ?? 0;
    const rows = pageData?.rows ?? [];
    const hasBathColumn = pageData?.hasBathTemperature ?? false;

    const visiblePages = useMemo(() => {
        return Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            if (totalPages <= 5) return i + 1;
            if (currentPage <= 3) return i + 1;
            if (currentPage >= totalPages - 2) return totalPages - 4 + i;
            return currentPage - 2 + i;
        });
    }, [currentPage, totalPages]);

    const formatValue = (val: number | null | undefined, decimals = 2) => {
        if (val === undefined || val === null) return '—';
        if (!Number.isFinite(val)) return '—';
        if (val === 0) return (0).toFixed(decimals);
        return val.toFixed(decimals);
    };

    const formatTime = (sec: number | null | undefined) => {
        if (sec === undefined || sec === null || !Number.isFinite(sec)) return '—';
        if (sec === 0) return '0:00';
        const mins = Math.floor(sec / 60);
        const secs = Math.round(sec % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (isLoading && !pageData) {
        return (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent mr-3" />
                Загружаем страницу данных
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-card/50 rounded-xl p-6 border border-border text-center space-y-3">
                <p className="text-muted-foreground">{error}</p>
                <Button variant="outline" onClick={() => setReloadToken(token => token + 1)}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Повторить
                </Button>
            </div>
        );
    }

    if (!isLoading && totalRows === 0) {
        return (
            <div className="bg-card/50 rounded-xl p-6 border border-border text-center">
                <p className="text-muted-foreground">Нет данных для отображения</p>
            </div>
        );
    }

    return (
        <CollapsibleCard
            title={
                <span className="flex items-center gap-2">
                    Сырые данные
                    <span className="text-muted-foreground font-normal text-sm">
                        ({totalRows} точек)
                    </span>
                </span>
            }
            headerActions={
                <div className="text-sm text-muted-foreground">
                    Страница {currentPage} из {totalPages}
                </div>
            }
            defaultOpen={false}
        >
            <div className="border-t border-border">
                <Table>
                    <TableHeader className="bg-secondary/50">
                        <TableRow className="border-border hover:bg-transparent">
                            <TableHead className="w-14 text-center font-medium text-muted-foreground">#</TableHead>
                            <TableHead className="w-20 text-left font-medium text-muted-foreground">Время</TableHead>
                            <TableHead className="text-center font-medium text-muted-foreground">Вязкость (cP)</TableHead>
                            <TableHead className="text-center font-medium text-muted-foreground">Температура (°C)</TableHead>
                            {hasBathColumn && (
                                <TableHead className="text-center font-medium text-muted-foreground">Темп. бани (°C)</TableHead>
                            )}
                            <TableHead className="text-center font-medium text-muted-foreground">Скорость (RPM)</TableHead>
                            <TableHead className="text-center font-medium text-muted-foreground">Скор. сдвига (1/s)</TableHead>
                            <TableHead className="text-center font-medium text-muted-foreground">Напр. сдвига (Pa)</TableHead>
                            <TableHead className="text-center font-medium text-muted-foreground">Давление (bar)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map(point => (
                            <TableRow
                                key={point.index}
                                className="border-border/50 hover:bg-muted/30 transition-colors"
                            >
                                <TableCell className="text-center text-muted-foreground tabular-nums py-2">{point.index}</TableCell>
                                <TableCell className="text-left text-foreground font-mono tabular-nums py-2">
                                    {formatTime(point.timeSec)}
                                </TableCell>
                                <TableCell className="text-center text-blue-700 dark:text-blue-400 font-mono font-medium tabular-nums py-2">
                                    {formatValue(point.viscosityCp, precision.viscosity)}
                                </TableCell>
                                <TableCell className="text-center text-orange-600 dark:text-orange-400 font-mono tabular-nums py-2">
                                    {formatValue(point.temperatureC, precision.temperature)}
                                </TableCell>
                                {hasBathColumn && (
                                    <TableCell className="text-center text-amber-700 dark:text-amber-400 font-mono tabular-nums py-2">
                                        {formatValue(point.bathTemperatureC, precision.temperature)}
                                    </TableCell>
                                )}
                                <TableCell className="text-center text-foreground/80 font-mono tabular-nums py-2">
                                    {formatValue(point.speedRpm, precision.rpm)}
                                </TableCell>
                                <TableCell className="text-center text-purple-700 dark:text-purple-400 font-mono tabular-nums py-2">
                                    {formatValue(point.shearRateS1, precision.shearRate)}
                                </TableCell>
                                <TableCell className="text-center text-teal-700 dark:text-teal-400 font-mono tabular-nums py-2">
                                    {formatValue(point.shearStressPa, 2)}
                                </TableCell>
                                <TableCell className="text-center text-green-700 dark:text-green-400 font-mono tabular-nums py-2">
                                    {formatValue(point.pressureBar, precision.pressure)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-border flex items-center justify-center gap-2 bg-secondary/20">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1 || isLoading}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        aria-label="Первая страница"
                    >
                        <ChevronsLeft className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1 || isLoading}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        aria-label="Предыдущая страница"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>

                    <div className="flex gap-1">
                        {visiblePages.map(pageNum => (
                            <Button
                                key={pageNum}
                                variant={currentPage === pageNum ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setCurrentPage(pageNum)}
                                disabled={isLoading}
                                className={`h-8 w-8 p-0 font-medium ${currentPage === pageNum
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                {pageNum}
                            </Button>
                        ))}
                    </div>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages || isLoading}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        aria-label="Следующая страница"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages || isLoading}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        aria-label="Последняя страница"
                    >
                        <ChevronsRight className="w-4 h-4" />
                    </Button>
                </div>
            )}
        </CollapsibleCard>
    );
});

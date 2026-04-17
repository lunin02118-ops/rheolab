import { useState, useMemo, memo } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';

interface RheoDataPoint {
    time_sec: number;
    viscosity_cp: number;
    temperature_c: number;
    speed_rpm: number;
    shear_rate_s1: number;
    shear_stress_pa: number;
    pressure_bar: number;
    bath_temperature_c?: number;
}

interface RawDataTableProps {
    data: RheoDataPoint[];
    pageSize?: number;
}

export const RawDataTable = memo(function RawDataTable({ data, pageSize = 25 }: RawDataTableProps) {
    const [currentPage, setCurrentPage] = useState(1);
    const chartSettings = useChartSettingsStore(s => s.settings);

    const hasBathColumn = useMemo(
        () => data.some(p => p.bath_temperature_c != null && p.bath_temperature_c !== 0),
        [data]
    );

    const totalPages = Math.ceil(data.length / pageSize);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return data.slice(start, start + pageSize);
    }, [data, currentPage, pageSize]);

    const formatValue = (val: number | undefined, decimals = 2) => {
        if (val === undefined || val === null) return '—';
        if (!Number.isFinite(val)) return '—';
        if (val === 0) return (0).toFixed(decimals);
        return val.toFixed(decimals);
    };

    // Use precision from settings
    const { precision } = chartSettings;

    const formatTime = (sec: number) => {
        if (!Number.isFinite(sec)) return '—';
        if (sec === 0) return '0:00';
        const mins = Math.floor(sec / 60);
        const secs = Math.round(sec % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (data.length === 0) {
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
                        ({data.length} точек)
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
            {/* Table */}
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
                        {paginatedData.map((point, idx) => {
                            const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                            return (
                                <TableRow
                                    key={idx}
                                    className="border-border/50 hover:bg-muted/30 transition-colors"
                                >
                                    <TableCell className="text-center text-muted-foreground tabular-nums py-2">{globalIdx}</TableCell>
                                    <TableCell className="text-left text-foreground font-mono tabular-nums py-2">
                                        {formatTime(point.time_sec)}
                                    </TableCell>
                                    <TableCell className="text-center text-blue-700 dark:text-blue-400 font-mono font-medium tabular-nums py-2">
                                        {formatValue(point.viscosity_cp, precision.viscosity)}
                                    </TableCell>
                                    <TableCell className="text-center text-orange-600 dark:text-orange-400 font-mono tabular-nums py-2">
                                        {formatValue(point.temperature_c, precision.temperature)}
                                    </TableCell>
                                    {hasBathColumn && (
                                        <TableCell className="text-center text-amber-700 dark:text-amber-400 font-mono tabular-nums py-2">
                                            {formatValue(point.bath_temperature_c, precision.temperature)}
                                        </TableCell>
                                    )}
                                    <TableCell className="text-center text-foreground/80 font-mono tabular-nums py-2">
                                        {formatValue(point.speed_rpm, precision.rpm)}
                                    </TableCell>
                                    <TableCell className="text-center text-purple-700 dark:text-purple-400 font-mono tabular-nums py-2">
                                        {formatValue(point.shear_rate_s1, precision.shearRate)}
                                    </TableCell>
                                    <TableCell className="text-center text-teal-700 dark:text-teal-400 font-mono tabular-nums py-2">
                                        {formatValue(point.shear_stress_pa, 2)}
                                    </TableCell>
                                    <TableCell className="text-center text-green-700 dark:text-green-400 font-mono tabular-nums py-2">
                                        {formatValue(point.pressure_bar, precision.pressure)}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-border flex items-center justify-center gap-2 bg-secondary/20">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        aria-label="Первая страница"
                    >
                        <ChevronsLeft className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        aria-label="Предыдущая страница"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>

                    <div className="flex gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum: number;
                            if (totalPages <= 5) {
                                pageNum = i + 1;
                            } else if (currentPage <= 3) {
                                pageNum = i + 1;
                            } else if (currentPage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                            } else {
                                pageNum = currentPage - 2 + i;
                            }

                            return (
                                <Button
                                    key={pageNum}
                                    variant={currentPage === pageNum ? "default" : "ghost"}
                                    size="sm"
                                    onClick={() => setCurrentPage(pageNum)}
                                    className={`h-8 w-8 p-0 font-medium ${currentPage === pageNum
                                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                        : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    {pageNum}
                                </Button>
                            );
                        })}
                    </div>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        aria-label="Следующая страница"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
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

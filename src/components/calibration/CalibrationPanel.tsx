import { logger } from '@/lib/logger';

import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { CALIBRATION_LIMITS } from '@/lib/calibration/constants';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { CalibrationCharts } from './CalibrationChartsUplot';
import type { CalibrationDataPoint } from '@/types/calibration';

interface CalibrationData {
    deviceType: string;
    rSquared: number;
    slope: number;
    intercept: number;
    hysteresis: number;
    stdev: number;
    status: 'PASS' | 'FAIL';
    lastCalDate?: string;
    issues: string[];
    rawData: string;
}

interface CalibrationPanelProps {
    calibration?: CalibrationData | null;
}

interface ModalContent {
    title: string;
    text: string;
}

/**
 * Форматирует дату калибровки для отображения (только дата без времени)
 */
function formatCalibrationDate(dateStr?: string): string {
    if (!dateStr) return '';

    // Если уже есть только дата в формате DD.MM.YYYY или MM-DD-YYYY
    if (/^\d{2}[.\-\/]\d{2}[.\-\/]\d{4}$/.test(dateStr)) {
        return dateStr;
    }

    // Если содержит время, извлекаем только дату
    const dateMatch = dateStr.match(/(\d{2}[.\-\/]\d{2}[.\-\/]\d{4})/);
    if (dateMatch) {
        return dateMatch[1];
    }

    // Попробуем парсить как Date и отформатировать
    try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('ru-RU');
        }
    } catch (_e) {
        logger.info(`CalibrationPanel: failed to parse date string '${dateStr}'`);
    }

    return dateStr;
}

export function CalibrationPanel({ calibration }: CalibrationPanelProps) {
    const [modalContent, setModalContent] = useState<ModalContent | null>(null);
    const focusTrapRef = useFocusTrap<HTMLDivElement>(!!modalContent);

    // No calibration data found
    if (!calibration) {
        return (
            <div className="p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-4">
                    <Info className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground/80 mb-2">
                    Калибровка не найдена
                </h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    В загруженном файле не обнаружен лист с калибровочными данными.
                    Калибровка автоматически извлекается из файлов BSL и Chandler,
                    содержащих лист "Калибровка" или "Calibration".
                </p>
            </div>
        );
    }

    const { deviceType, rSquared, slope, intercept, hysteresis, stdev, status, lastCalDate, issues, rawData } = calibration;

    // Parse raw data for charts
    let chartData: CalibrationDataPoint[] = [];
    try {
        chartData = JSON.parse(rawData);
    } catch (e) {
        logger.warn('Failed to parse calibration chart data:', e);
    }

    const deviceLabel = deviceType === 'bslR1' ? 'BSL R1' :
        deviceType === 'chandlerCSV' ? 'Chandler CSV' : 'Chandler 5550';

    const formattedDate = formatCalibrationDate(lastCalDate);

    const handleShowDetails = (title: string, text: string) => {
        setModalContent({ title, text });
    };

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${status === 'PASS' ? 'bg-green-500/20' : 'bg-red-500/20'
                    }`}>
                    {status === 'PASS' ? (
                        <CheckCircle className="w-5 h-5 text-green-400" />
                    ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                    )}
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-foreground">
                        Калибровка {status === 'PASS' ? 'пройдена' : 'не пройдена'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {deviceLabel} {formattedDate && `• ${formattedDate}`}
                    </p>
                </div>
            </div>

            {/* Issues */}
            {issues.length > 0 && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-red-400 font-medium mb-2">Обнаруженные проблемы:</p>
                            <ul className="list-disc list-inside text-sm text-red-300/80 space-y-1">
                                {issues.map((issue, i) => (
                                    <li key={i}>{issue}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Metrics Grid */}
            <div className="grid grid-cols-5 gap-3">
                <MetricCard
                    label="Линейность (R²)"
                    value={rSquared.toFixed(6)}
                    sub={`Норма: > ${CALIBRATION_LIMITS.R_SQUARED}`}
                    tooltip="Показывает, насколько точно данные соответствуют прямой линии (метод наименьших квадратов)."
                    details="Если R² низок: 1) Возможны грубые ошибки. 2) Проверьте, не 'замерзли' ли подшипники. 3) Нет ли посторонних предметов в зазоре ротор-боб. 4) Убедитесь в отсутствии пузырьков воздуха."
                    isBad={rSquared < CALIBRATION_LIMITS.R_SQUARED}
                    onShowDetails={handleShowDetails}
                />
                <MetricCard
                    label="Коэффициент (Slope)"
                    value={slope.toFixed(4)}
                    tooltip="Оценка константы пружины в dyne/cm² на градус."
                    details="Это 'жесткость' датчика. Он показывает, сколько силы нужно приложить, чтобы повернуть датчик на 1 градус."
                    onShowDetails={handleShowDetails}
                />
                <MetricCard
                    label="Смещение (Intercept)"
                    value={intercept.toFixed(4)}
                    tooltip="Указывает на смещение датчика (offset). Должно быть близко к нулю."
                    details="Это 'ноль' прибора. Если прибор ничем не нагружен, он должен показывать 0."
                    onShowDetails={handleShowDetails}
                />
                <MetricCard
                    label="Гистерезис"
                    value={hysteresis.toFixed(2)}
                    unit="dyne/cm²"
                    sub={`Норма: < ${CALIBRATION_LIMITS.HYSTERESIS}`}
                    tooltip="Указывает на общее трение в системе (разница при нагрузке и разгрузке)."
                    details="Признак механического трения. Если значение велико: 1) Проверьте, не погнута ли термопара. 2) Осмотрите подшипники вала боба (замена < 10 мин). 3) Проверьте 'ограничитель подъема геля' (climb arrestor). 4) Используйте проставку (spacing tool)."
                    isBad={hysteresis > CALIBRATION_LIMITS.HYSTERESIS}
                    onShowDetails={handleShowDetails}
                />
                <MetricCard
                    label="Отклонение (StDev)"
                    value={stdev.toFixed(2)}
                    unit="dyne/cm²"
                    sub={`Норма: < ${CALIBRATION_LIMITS.STDEV}`}
                    tooltip="Нормализованный показатель общего трения подшипников."
                    details="Показывает 'шум' в измерениях. Высокое значение требует: 1) Проверки стабильности показаний. 2) Очистки узла или замены жидкости. 3) Проверки подшипников вала боба на износ."
                    isBad={stdev > CALIBRATION_LIMITS.STDEV}
                    onShowDetails={handleShowDetails}
                />
            </div>

            {/* Charts */}
            {chartData.length > 0 && (
                <CalibrationCharts data={chartData} />
            )}

            {/* Modal */}
            {modalContent && (
                <div ref={focusTrapRef} role="dialog" aria-modal="true" className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl">
                        <div className="flex items-start justify-between mb-4">
                            <h3 className="text-lg font-bold text-foreground">{modalContent.title}</h3>
                            <button
                                onClick={() => setModalContent(null)}
                                className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="Закрыть"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                            {modalContent.text}
                        </p>
                        <button
                            onClick={() => setModalContent(null)}
                            className="mt-6 w-full py-2.5 px-4 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-400 rounded-lg font-medium transition-colors"
                        >
                            Понятно
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

interface MetricCardProps {
    label: string;
    value: string | number;
    unit?: string;
    sub?: string;
    tooltip?: string;
    details?: string;
    isBad?: boolean;
    onShowDetails: (title: string, text: string) => void;
}

function MetricCard({ label, value, unit, sub, tooltip, details, isBad, onShowDetails }: MetricCardProps) {
    return (
        <div
            className={`
                relative overflow-hidden rounded-xl p-3 border transition-colors duration-200
                ${isBad
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-secondary/50 border-border/50 hover:border-cyan-500/30'
                }
            `}
            title={tooltip}
        >
            {/* Background Glow */}
            <div className={`
                absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-10 pointer-events-none
                ${isBad ? 'bg-red-500' : 'bg-cyan-400'}
            `} style={{ filter: 'none' }} />

            <div className="flex justify-between items-start mb-2 relative z-10">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                        {label}
                    </span>
                    {tooltip && (
                        <Info className="w-3 h-3 text-muted-foreground cursor-help hover:text-cyan-400 transition-colors" />
                    )}
                </div>

                {/* Status Indicator Dot */}
                <div className={`
                    w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]
                    ${isBad ? 'bg-red-500 text-red-500' : 'bg-cyan-400 text-cyan-400'}
                `} />
            </div>

            <div className="relative z-10 mb-2">
                <div className="flex items-baseline gap-1.5">
                    <span className={`
                        font-mono text-2xl font-bold tracking-tight
                        ${isBad ? 'text-red-400' : 'text-foreground'}
                    `}>
                        {value}
                    </span>
                    {unit && (
                        <span className="text-xs font-medium text-muted-foreground">
                            {unit}
                        </span>
                    )}
                </div>

                {sub && (
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                        <div className={`w-1.5 h-1.5 rounded-full ${isBad ? 'bg-red-500' : 'bg-cyan-400/50'}`} />
                        {sub}
                    </div>
                )}
            </div>

            {details && (
                <div className="pt-2 border-t border-border/50 relative z-10">
                    <button
                        className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 uppercase tracking-widest transition-colors flex items-center gap-1.5"
                        onClick={(e) => {
                            e.preventDefault();
                            onShowDetails(label, details);
                        }}
                    >
                        Подробнее
                        <span className="text-base leading-none mb-0.5">→</span>
                    </button>
                </div>
            )}
        </div>
    );
}

import * as React from 'react';
import { Ruler, AlertTriangle } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "@/components/ui/select";

// Available geometries with K-factors
const GEOMETRIES = [
    { value: 'R1B1', label: 'R1B1', kFactor: 1.703, description: 'Ротор 1, Боб 1 (малый зазор)' },
    { value: 'R1B2', label: 'R1B2', kFactor: 0.377, description: 'Ротор 1, Боб 2 (большой зазор)' },
    { value: 'R1B5', label: 'R1B5', kFactor: 0.847, description: 'Ротор 1, Боб 5 (стандарт)' },
] as const;


interface GeometrySelectorProps {
    currentGeometry?: string;
    geometrySource?: 'context' | 'loose' | 'physics' | 'default' | 'manual' | 'unknown';
    onGeometryChange?: (geometry: string, kFactor: number) => void;
    disabled?: boolean;
}

export const GeometrySelector = React.memo(function GeometrySelector({
    currentGeometry = 'R1B5',
    geometrySource = 'default',
    onGeometryChange,
    disabled = false
}: GeometrySelectorProps) {

    const [selectedGeometry, setSelectedGeometry] = React.useState(currentGeometry);

    // Sync state with prop
    React.useEffect(() => {
        setSelectedGeometry(currentGeometry);
    }, [currentGeometry]);

    const needsAttention = geometrySource === 'default';
    const currentGeo = GEOMETRIES.find(g => g.value === selectedGeometry) || GEOMETRIES[2]; // R1B5 default

    const sourceLabels: Record<string, string> = {
        context: 'контекст',
        loose: 'поиск',
        physics: 'физика',
        default: 'по умолчанию',
        manual: 'вручную',
        unknown: 'неизвестно'
    };

    return (
        <Select
            value={needsAttention ? '' : selectedGeometry}
            onValueChange={(value) => {
                const geo = GEOMETRIES.find(g => g.value === value);
                if (geo) {
                    setSelectedGeometry(value);
                    onGeometryChange?.(value, geo.kFactor);
                }
            }}
            disabled={disabled}
        >
            <SelectTrigger
                className={`w-[320px] h-auto py-2 ${needsAttention
                    ? 'border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
                    : geometrySource === 'context'
                        ? 'border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                        : 'border-border bg-secondary/50 hover:bg-secondary/50 text-foreground'
                    }`}
            >
                <div className="flex items-center gap-3 text-left">
                    <Ruler className={`w-4 h-4 mt-0.5 ${needsAttention
                        ? 'text-amber-400'
                        : geometrySource === 'context'
                            ? 'text-emerald-400'
                            : 'text-muted-foreground'}`} />
                    <div className="flex flex-col overflow-hidden">
                        <span className="font-semibold text-sm truncate">
                            {currentGeo.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
                            K={currentGeo.kFactor} • {sourceLabels[geometrySource]}
                        </span>
                    </div>
                </div>
            </SelectTrigger>
            <SelectContent className="bg-secondary border-border text-foreground">
                {needsAttention && (
                    <div className="px-2 py-2 bg-amber-500/10 border-b border-border mb-1">
                        <p className="text-xs text-amber-300 flex items-center gap-2 px-2">
                            <AlertTriangle className="w-3 h-3" />
                            Геометрия не определена
                        </p>
                    </div>
                )}
                {GEOMETRIES.map((geo) => (
                    <SelectItem
                        key={geo.value}
                        value={geo.value}
                        className="focus:bg-secondary focus:text-foreground cursor-pointer py-2"
                    >
                        <div className="flex flex-col gap-0.5">
                            <span className="font-medium">{geo.label}</span>
                            <span className="text-xs text-muted-foreground">
                                K={geo.kFactor} • {geo.description}
                            </span>
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
});

import { Ruler, Cpu, Droplet } from 'lucide-react';

export interface InstrumentInfo {
    geometry?: string;
    geometrySource?: 'context' | 'loose' | 'physics' | 'default';
    instrumentType?: string;
    sheetName?: string;
    fluidType?: string;
}

const sourceLabels = {
    context: 'из контекста',
    loose: 'поиск',
    physics: 'K-фактор',
    default: ''
};

function InstrumentBadge({ instrumentType }: { instrumentType?: string }) {
    if (!instrumentType || instrumentType === 'Rheometer') return null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-500/20 border border-blue-300 dark:border-blue-500/30 rounded-lg">
            <Cpu className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span className="text-blue-700 dark:text-blue-300 text-sm font-medium">{instrumentType}</span>
        </div>
    );
}

function GeometryBadge({ geometry, geometrySource }: {
    geometry?: string;
    geometrySource?: InstrumentInfo['geometrySource'];
}) {
    if (!geometry) return null;

    const sourceLabel = geometrySource ? sourceLabels[geometrySource] : '';

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-300 dark:border-emerald-500/30 rounded-lg">
            <Ruler className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{geometry}</span>
            {sourceLabel && (
                <span className="text-emerald-600/80 dark:text-emerald-500/60 text-xs">({sourceLabel})</span>
            )}
        </div>
    );
}

function FluidTypeBadge({ fluidType }: { fluidType?: string }) {
    if (!fluidType) return null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 dark:bg-purple-500/20 border border-purple-300 dark:border-purple-500/30 rounded-lg">
            <Droplet className="w-4 h-4 text-purple-700 dark:text-purple-400" />
            <span className="text-purple-700 dark:text-purple-300 text-sm font-medium">{fluidType}</span>
        </div>
    );
}

export function InstrumentBadges({ instrumentInfo }: { instrumentInfo?: InstrumentInfo }) {
    if (!instrumentInfo) return null;

    return (
        <div className="flex flex-wrap items-center gap-2">
            <InstrumentBadge instrumentType={instrumentInfo.instrumentType} />
            <FluidTypeBadge fluidType={instrumentInfo.fluidType} />
            <GeometryBadge
                geometry={instrumentInfo.geometry}
                geometrySource={instrumentInfo.geometrySource}
            />
        </div>
    );
}

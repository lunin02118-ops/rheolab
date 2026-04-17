import * as React from 'react';
import { Cpu, AlertTriangle } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "@/components/ui/select";

// Available instruments
const INSTRUMENTS = [
    { value: 'Grace M5600', label: 'Grace M5600 HPHT' },
    { value: 'Chandler 5550', label: 'Chandler Engineering 5550' },
    { value: 'Fann 50', label: 'Fann 50 Вискозиметр' },
    { value: 'Fann 35', label: 'Fann 35 Вискозиметр' },
    { value: 'Brookfield PVS', label: 'Brookfield PVS' },
    { value: 'BSL', label: 'BSL Реометр' },
    { value: 'Ofite', label: 'OFITE Модель 1100' },
] as const;

interface InstrumentSelectorProps {
    currentInstrument?: string;
    onInstrumentChange?: (instrument: string) => void;
    disabled?: boolean;
}

export const InstrumentSelector = React.memo(function InstrumentSelector({
    currentInstrument,
    onInstrumentChange,
    disabled = false
}: InstrumentSelectorProps) {
    const [selectedInstrument, setSelectedInstrument] = React.useState(currentInstrument);

    // Sync state with props
    React.useEffect(() => {
        setSelectedInstrument(currentInstrument);
    }, [currentInstrument]);



    const isUnknown = !selectedInstrument || selectedInstrument === 'Unknown' || selectedInstrument === 'undefined';
    const currentLabel = INSTRUMENTS.find(i => i.value === selectedInstrument)?.label || selectedInstrument || 'Не определён';

    return (
        <Select
            value={selectedInstrument}
            onValueChange={(value) => {
                setSelectedInstrument(value);
                onInstrumentChange?.(value);
            }}
            disabled={disabled}
        >
            <SelectTrigger
                className={`w-[280px] h-auto py-2 ${isUnknown
                    ? 'border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300'
                    : 'border-border bg-secondary/50 hover:bg-secondary/50 text-foreground'
                    }`}
            >
                <div className="flex items-center gap-3 text-left">
                    <Cpu className={`w-4 h-4 mt-0.5 ${isUnknown ? 'text-amber-400' : 'text-muted-foreground'}`} />
                    <div className="flex flex-col">
                        <span className="font-semibold text-sm truncate">
                            {currentLabel}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            {isUnknown ? 'Выберите прибор' : 'Тип устройства'}
                        </span>
                    </div>
                </div>
            </SelectTrigger>
            <SelectContent className="bg-secondary border-border text-foreground max-h-[300px]">
                {isUnknown && (
                    <div className="px-2 py-2 bg-amber-500/10 border-b border-border mb-1">
                        <p className="text-xs text-amber-300 flex items-center gap-2 px-2">
                            <AlertTriangle className="w-3 h-3" />
                            Прибор не найден
                        </p>
                    </div>
                )}
                {INSTRUMENTS.map((inst) => (
                    <SelectItem
                        key={inst.value}
                        value={inst.value}
                        className="focus:bg-secondary focus:text-foreground cursor-pointer"
                    >
                        {inst.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
});

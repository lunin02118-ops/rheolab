import { useUIMode } from '@/contexts/ui-mode-context';
import { Sparkles, Wrench } from 'lucide-react';

export function UIModeToggle() {
    const { mode, toggleMode } = useUIMode();
    const isExpert = mode === 'expert';

    return (
        <button
            onClick={toggleMode}
            className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${isExpert
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20'
                : 'bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-border'
                }`}
            title={isExpert ? 'Режим: Эксперт' : 'Режим: Новичок'}
        >
            {isExpert ? (
                <>
                    <Wrench className="w-3.5 h-3.5" />
                    Эксперт
                </>
            ) : (
                <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Базовый
                </>
            )}
        </button>
    );
}

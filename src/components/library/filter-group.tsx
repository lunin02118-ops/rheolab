import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface FilterGroupProps {
    title: string;
    icon?: ReactNode;
    defaultOpen?: boolean;
    /** Number of active filters inside this group (shows badge) */
    activeCount?: number;
    children: ReactNode;
}

export function FilterGroup({
    title,
    icon,
    defaultOpen = false,
    activeCount = 0,
    children,
}: FilterGroupProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="border-t border-border/60 first:border-t-0">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex items-center justify-between w-full py-2.5 group"
            >
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                    {icon}
                    {title}
                    {activeCount > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                            {activeCount}
                        </span>
                    )}
                </span>
                <ChevronDown
                    className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
                        open ? 'rotate-180' : ''
                    }`}
                />
            </button>
            {open && (
                <div className="pb-3 space-y-3">
                    {children}
                </div>
            )}
        </div>
    );
}

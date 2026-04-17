import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CollapsibleCardProps {
    title: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
    headerActions?: React.ReactNode;
    className?: string;
}

export function CollapsibleCard({
    title,
    children,
    defaultOpen = true,
    headerActions,
    className = ''
}: CollapsibleCardProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const toggle = useCallback(() => setIsOpen(v => !v), []);

    // Sync: when defaultOpen transitions to true (e.g. async data loaded), open the card.
    // Only opens, never force-closes, so manual user collapse is preserved.
    useEffect(() => {
        if (defaultOpen) setIsOpen(true);
    }, [defaultOpen]);

    return (
        <div className={cn("w-full", className)}>
            <Card className="bg-gradient-to-br from-card to-secondary border-border overflow-hidden shadow-xl">
                <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={toggle}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                    className="px-4 py-3 border-b border-border flex items-center justify-between cursor-pointer hover:bg-secondary/50 transition-colors select-none"
                >
                    <div className="flex items-center gap-3 flex-1">
                        <div className="flex items-center justify-center h-8 w-8 rounded hover:bg-secondary text-muted-foreground transition-colors">
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                        <div className="font-semibold text-foreground">
                            {title}
                        </div>
                    </div>

                    {headerActions && (
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            {headerActions}
                        </div>
                    )}
                </div>

                {/* Always keep children mounted so chart ResizeObserver retains real dimensions.
                    When collapsed: clip to 0 visible height with overflow-hidden, but children
                    inside still have their natural layout (width/height) so ResizeObserver works.
                    aria-hidden prevents screen reader access when collapsed. */}
                <div
                    style={isOpen ? undefined : { height: 0, overflow: 'hidden', visibility: 'hidden' as const }}
                    aria-hidden={!isOpen}
                >
                    {children}
                </div>
            </Card>
        </div>
    );
}

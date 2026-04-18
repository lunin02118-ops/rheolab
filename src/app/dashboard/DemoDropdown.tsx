import { Beaker, ChevronDown } from 'lucide-react';

interface FixtureItem {
    name: string;
    displayName: string;
}

interface DemoDropdownProps {
    fixtures: FixtureItem[];
    loadingFixture: string | null;
    showDropdown: boolean;
    setShowDropdown: (show: boolean) => void;
    loadFixture: (name: string) => void;
}

export function DemoDropdown({
    fixtures,
    loadingFixture,
    showDropdown,
    setShowDropdown,
    loadFixture,
}: DemoDropdownProps) {
    if (fixtures.length === 0) return null;

    return (
        <div className="relative">
            <button
                onClick={() => setShowDropdown(!showDropdown)}
                data-testid="DemoFilesButton"
                className="flex items-center gap-2 px-4 py-2 bg-purple-100 dark:bg-purple-600/20 border border-purple-400 dark:border-purple-500/30 rounded-lg text-purple-700 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-600/30 transition-colors"
            >
                <Beaker className="w-4 h-4" />
                <span>Demo Файлы</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDropdown && (
                <div
                    data-testid="DemoFilesDropdown"
                    className="absolute right-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50"
                >
                    <div className="p-2 border-b border-border">
                        <p className="text-xs text-muted-foreground px-2">Тестовые файлы ({fixtures.length})</p>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                        {fixtures.map((fixture) => (
                            <button
                                key={fixture.name}
                                onClick={() => loadFixture(fixture.name)}
                                disabled={loadingFixture === fixture.name}
                                data-testid={`DemoFileItem-${fixture.name}`}
                                className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-secondary/70 transition-colors flex items-center justify-between disabled:opacity-50"
                            >
                                <span className="truncate">{fixture.displayName}</span>
                                {loadingFixture === fixture.name && (
                                    <span className="text-xs text-purple-400 animate-pulse">Loading...</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

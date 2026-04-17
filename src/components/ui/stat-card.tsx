interface StatCardProps {
    label: string;
    value: string;
    color: 'blue' | 'purple' | 'orange' | 'green' | 'red';
}

const colorClasses = {
    blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30 text-blue-400',
    purple: 'from-purple-500/20 to-purple-600/20 border-purple-500/30 text-purple-400',
    orange: 'from-orange-500/20 to-orange-600/20 border-orange-500/30 text-orange-400',
    green: 'from-green-500/20 to-green-600/20 border-green-500/30 text-green-400',
    red: 'from-red-500/20 to-red-600/20 border-red-500/30 text-red-400',
};

export function StatCard({ label, value, color }: StatCardProps) {
    return (
        <div
            className={`bg-gradient-to-br ${colorClasses[color]} rounded-lg px-3 py-1.5 border`}
        >
            <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
            <p className={`text-sm font-bold ${colorClasses[color].split(' ').pop()}`}>
                {value}
            </p>
        </div>
    );
}

export type { StatCardProps };

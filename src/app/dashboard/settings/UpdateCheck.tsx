import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Loader2, CheckCircle2, Wifi, WifiOff } from 'lucide-react';
import { APP_VERSION } from '@/lib/version';
import { useUpdateStore } from '@/lib/store/update-store';
import { checkUpdateNow } from '@/components/shared/UpdateChecker';
import { Button } from '@/components/ui/button';

// The exact endpoint pattern from tauri.conf.json with {{target}} resolved.
// Tauri v2 resolves {{target}} to OS-ARCH, e.g. windows-x86_64.
const UPDATE_ENDPOINT = 'https://license.vizbuka.ru/releases/v1/update/windows-x86_64/stable.json';

interface DiagResult {
    url: string;
    status: number | null;
    latencyMs: number | null;
    contentType: string | null;
    serverVersion: string | null;
    jsonOk: boolean;
    error: string | null;
}

function UpdateDiagnosticPanel({ appVersion }: { appVersion: string }) {
    const [result, setResult] = useState<DiagResult | null>(null);
    // Initial state is `true` because the auto-run useEffect below kicks off
    // a diagnostic on mount.  The retry button toggles it explicitly in its
    // event handler.
    const [running, setRunning] = useState(true);

    async function runDiag() {
        const start = performance.now();
        const diag: DiagResult = { url: UPDATE_ENDPOINT, status: null, latencyMs: null, contentType: null, serverVersion: null, jsonOk: false, error: null };
        try {
            const res = await fetch(UPDATE_ENDPOINT, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            });
            diag.latencyMs = Math.round(performance.now() - start);
            diag.status = res.status;
            diag.contentType = res.headers.get('content-type');
            if (res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    diag.jsonOk = true;
                    diag.serverVersion = json.version ?? null;
                } catch (e) {
                    diag.error = `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`;
                }
            } else {
                diag.error = `HTTP ${res.status} ${res.statusText}`;
            }
        } catch (e) {
            diag.latencyMs = Math.round(performance.now() - start);
            diag.error = e instanceof Error ? e.message : String(e);
        }
        setResult(diag);
        setRunning(false);
    }

    // Auto-run on mount
    useEffect(() => { void runDiag(); }, []);

    const ok = result && result.jsonOk && result.serverVersion;
    const newer = ok && result.serverVersion
        ? result.serverVersion.replace(/^v/, '').split('.').map(Number)
            .reduce((acc, v, i) => acc || v > appVersion.replace(/^v/, '').split('.').map(Number)[i]!, false as boolean)
        : false;

    return (
        <div className="mt-3 rounded-lg border border-border bg-secondary/60 p-4 text-xs font-mono space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-sans text-xs font-semibold uppercase tracking-wide">Диагностика соединения</span>
                <button
                    onClick={() => { setRunning(true); void runDiag(); }}
                    disabled={running}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
                >
                    <RefreshCw className={`w-3 h-3 ${running ? 'animate-spin' : ''}`} />
                    <span className="font-sans">{running ? 'Проверка…' : 'Повтор'}</span>
                </button>
            </div>

            <div className="text-muted-foreground break-all">{UPDATE_ENDPOINT}</div>

            {result ? (
                <div className="space-y-1">
                    <Row label="Приложение" value={`v${appVersion}`} />
                    <Row
                        label="HTTP"
                        value={result.status !== null ? String(result.status) : '—'}
                        ok={result.status === 200}
                    />
                    <Row
                        label="Задержка"
                        value={result.latencyMs !== null ? `${result.latencyMs} мс` : '—'}
                    />
                    <Row
                        label="Content-Type"
                        value={result.contentType ?? '—'}
                        ok={result.contentType?.includes('application/json') ?? false}
                    />
                    <Row
                        label="JSON"
                        value={result.jsonOk ? 'Валидный' : 'Ошибка'}
                        ok={result.jsonOk}
                    />
                    {result.serverVersion && (
                        <Row
                            label="Версия на сервере"
                            value={result.serverVersion}
                            ok={newer}
                            note={newer ? 'обновление доступно' : 'актуальная версия'}
                        />
                    )}
                    {result.error && (
                        <div className="mt-2 text-red-400 flex items-start gap-1.5">
                            <WifiOff className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span className="break-all">{result.error}</span>
                        </div>
                    )}
                    {ok && !result.error && (
                        <div className="mt-2 text-emerald-400 flex items-center gap-1.5">
                            <Wifi className="w-3.5 h-3.5" />
                            <span className="font-sans">Сервер обновлений доступен</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Проверка…
                </div>
            )}
        </div>
    );
}

function Row({ label, value, ok, note }: { label: string; value: string; ok?: boolean; note?: string }) {
    return (
        <div className="flex justify-between gap-4">
            <span className="text-muted-foreground font-sans">{label}</span>
            <span className={ok === true ? 'text-emerald-400' : ok === false ? 'text-red-400' : 'text-foreground/80'}>
                {value}{note ? <span className="text-muted-foreground ml-1">({note})</span> : null}
            </span>
        </div>
    );
}

export function UpdateCheckButton() {
    const status = useUpdateStore((state) => state.status);
    const version = useUpdateStore((state) => state.version);
    const error = useUpdateStore((state) => state.error);
    const [upToDate, setUpToDate] = useState(false);
    const [showDiag, setShowDiag] = useState(false);
    const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (resetTimerRef.current) {
                clearTimeout(resetTimerRef.current);
            }
        };
    }, []);

    const handleCheck = async () => {
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current);
            resetTimerRef.current = null;
        }
        setUpToDate(false);
        setShowDiag(false);
        await checkUpdateNow();
        const finalStatus = useUpdateStore.getState().status;
        if (finalStatus === 'idle') {
            setUpToDate(true);
            resetTimerRef.current = setTimeout(() => {
                setUpToDate(false);
                resetTimerRef.current = null;
            }, 4000);
        }
        if (finalStatus === 'error') {
            setShowDiag(true);
        }
    };

    if (status === 'available') {
        return (
            <span className="text-purple-400 text-sm font-medium flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Доступно v{version}
            </span>
        );
    }
    if (status === 'downloading' || status === 'ready') {
        return (
            <span className="text-blue-400 text-sm">Установка обновления…</span>
        );
    }
    if (status === 'error') {
        return (
            <div className="w-full">
                <div className="flex items-center justify-between">
                    <span
                        className="text-red-400 text-sm flex items-center gap-1.5 cursor-pointer hover:text-red-300"
                        onClick={handleCheck}
                        title="Нажмите для повторной проверки"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {error ?? 'Ошибка проверки обновлений'}
                    </span>
                    <button
                        className="text-muted-foreground hover:text-foreground/80 text-xs underline ml-3"
                        onClick={() => setShowDiag(v => !v)}
                    >
                        {showDiag ? 'Скрыть' : 'Диагностика'}
                    </button>
                </div>
                {showDiag && <UpdateDiagnosticPanel appVersion={APP_VERSION} />}
            </div>
        );
    }
    if (upToDate) {
        return (
            <span className="text-emerald-400 text-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Актуальная версия
            </span>
        );
    }

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={handleCheck}
            disabled={status === 'checking'}
            className="h-8 border-border text-foreground/80 hover:bg-secondary hover:text-foreground"
        >
            {status === 'checking'
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Проверяется…</>
                : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Проверить обновление</>
            }
        </Button>
    );
}

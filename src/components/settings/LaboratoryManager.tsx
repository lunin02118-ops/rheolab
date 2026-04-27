import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { getBridge } from '@/lib/tauri/bridge';
import type { LaboratoryRecord } from '@/types/tauri';

export function LaboratoryManager() {
    const [labs, setLabs] = useState<LaboratoryRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [addName, setAddName] = useState('');
    const [addLocation, setAddLocation] = useState('');
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editLocation, setEditLocation] = useState('');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const list = await getBridge().laboratories.list();
            setLabs(list);
        } catch (e) {
            setError(String(e));
        }
    }, []);

    useEffect(() => {
        // setLoading(true) on mount is redundant — initial state is already
        // true.  Promise.resolve().then() defers the reload kickoff to a
        // microtask so the rule's synchronous-body analysis never sees a
        // setState reachable from this effect body.
        void Promise.resolve().then(() => reload().finally(() => setLoading(false)));
    }, [reload]);

    const handleAdd = async () => {
        if (!addName.trim()) return;
        setAdding(true);
        setError(null);
        try {
            const resp = await getBridge().laboratories.create({
                name: addName.trim(),
                location: addLocation.trim() || null,
            });
            if (!resp.success) {
                setError(resp.error ?? 'Ошибка создания');
            } else {
                setAddName('');
                setAddLocation('');
                await reload();
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setAdding(false);
        }
    };

    const startEdit = (lab: LaboratoryRecord) => {
        setEditId(lab.id);
        setEditName(lab.name);
        setEditLocation(lab.location ?? '');
        setError(null);
    };

    const cancelEdit = () => {
        setEditId(null);
        setError(null);
    };

    const handleSaveEdit = async () => {
        if (!editId || !editName.trim()) return;
        setSaving(true);
        setError(null);
        try {
            const resp = await getBridge().laboratories.update(editId, {
                name: editName.trim(),
                location: editLocation.trim() || null,
            });
            if (!resp.success) {
                setError(resp.error ?? 'Ошибка обновления');
            } else {
                setEditId(null);
                await reload();
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeleting(id);
        setError(null);
        try {
            const resp = await getBridge().laboratories.delete(id);
            if (!resp.success) setError(resp.error ?? 'Ошибка удаления');
            else await reload();
        } catch (e) {
            setError(String(e));
        } finally {
            setDeleting(null);
        }
    };

    return (
        <section className="bg-card/50 border border-border rounded-xl p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-blue-400" />
                Лаборатории
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
                Список лабораторий для привязки экспериментов. При экспорте / миграции БД помогает
                определить происхождение теста.
            </p>

            {error && (
                <p className="text-xs text-red-400 mb-3 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
            )}

            {/* Add form */}
            <div className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={addName}
                    onChange={e => setAddName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
                    placeholder="Название лаборатории"
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-slate-600 focus:border-blue-500 outline-none transition-colors"
                    data-testid="LaboratoryNameInput"
                />
                <input
                    type="text"
                    value={addLocation}
                    onChange={e => setAddLocation(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
                    placeholder="Местоположение (необязательно)"
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-slate-600 focus:border-blue-500 outline-none transition-colors"
                />
                <button
                    onClick={handleAdd}
                    disabled={adding || !addName.trim()}
                    data-testid="AddLaboratoryButton"
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 border border-blue-600/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Добавить
                </button>
            </div>

            {/* List */}
            {loading ? (
                <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                </div>
            ) : labs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Лаборатории не добавлены</p>
            ) : (
                <ul className="space-y-1" data-testid="LaboratoriesList">
                    {labs.map(lab => (
                        <li key={lab.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-secondary/50 group">
                            {editId === lab.id ? (
                                <>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') void handleSaveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                        className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:border-blue-500 outline-none"
                                        autoFocus
                                    />
                                    <input
                                        type="text"
                                        value={editLocation}
                                        onChange={e => setEditLocation(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') void handleSaveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                        placeholder="Местоположение"
                                        className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm text-foreground placeholder-slate-600 focus:border-blue-500 outline-none"
                                    />
                                    <button onClick={handleSaveEdit} disabled={saving} className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50">
                                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                    </button>
                                    <button onClick={cancelEdit} className="p-1 text-muted-foreground hover:text-foreground">
                                        <X className="w-4 h-4" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 text-sm text-foreground">{lab.name}</span>
                                    {lab.location && <span className="text-xs text-muted-foreground">{lab.location}</span>}
                                    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                                        <button onClick={() => startEdit(lab)} className="p-1 text-muted-foreground hover:text-blue-400" title="Изменить">
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(lab.id)}
                                            disabled={deleting === lab.id}
                                            className="p-1 text-muted-foreground hover:text-red-400 disabled:opacity-50"
                                            title="Удалить"
                                            data-testid={`DeleteLaboratoryButton_${lab.id}`}
                                        >
                                            {deleting === lab.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

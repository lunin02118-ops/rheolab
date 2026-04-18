import { type RefObject } from 'react';
import { AlertTriangle, Save } from 'lucide-react';

interface OverwritePayload {
    name: string;
    testDate: string | Date;
}

interface NameConflictPayload {
    name: string;
}

interface ConfirmationDialogsProps {
    pendingOverwritePayload: OverwritePayload | null;
    pendingNameConflictPayload: NameConflictPayload | null;
    isSaving: boolean;
    nameConflictFocusTrapRef: RefObject<HTMLDivElement | null>;
    cancelOverwrite: () => void;
    confirmOverwrite: () => void;
    cancelNameConflict: () => void;
    confirmNameOverwrite: () => void;
}

export function ConfirmationDialogs({
    pendingOverwritePayload,
    pendingNameConflictPayload,
    isSaving,
    nameConflictFocusTrapRef,
    cancelOverwrite,
    confirmOverwrite,
    cancelNameConflict,
    confirmNameOverwrite,
}: ConfirmationDialogsProps) {
    return (
        <>
            {/* Overwrite Confirmation Dialog */}
            {pendingOverwritePayload && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
                <div
                    aria-labelledby="overwrite-dialog-title"
                    className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-3 bg-amber-500/20 rounded-full">
                            <AlertTriangle className="w-6 h-6 text-amber-500" />
                        </div>
                        <h3 id="overwrite-dialog-title" className="text-xl font-semibold text-foreground">Эксперимент уже существует</h3>
                    </div>

                        <p className="text-muted-foreground mb-6">
                            Отчёт с именем <span className="text-foreground font-medium">&quot;{pendingOverwritePayload.name}&quot;</span> от <span className="text-foreground font-medium">{new Date(pendingOverwritePayload.testDate).toLocaleDateString()}</span> уже сохранён в базе данных.
                            <br /><br />
                            Вы хотите <strong>перезаписать</strong> его текущими данными? Это действие нельзя отменить.
                        </p>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={cancelOverwrite}
                                className="px-4 py-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={confirmOverwrite}
                                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-lg shadow-amber-900/20 transition-colors flex items-center gap-2"
                            >
                                {isSaving ? <span className="animate-spin">⏳</span> : <Save className="w-4 h-4" />}
                                Перезаписать
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Name Conflict Dialog */}
            {pendingNameConflictPayload && (
                <div ref={nameConflictFocusTrapRef} role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div
                        aria-labelledby="name-conflict-dialog-title"
                        className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-3 bg-amber-500/20 rounded-full">
                                <AlertTriangle className="w-6 h-6 text-amber-500" />
                            </div>
                            <h3 id="name-conflict-dialog-title" className="text-xl font-semibold text-foreground">Совпадение названия</h3>
                        </div>
                        <p className="text-muted-foreground mb-6">
                            Тест «<span className="text-foreground font-medium">{pendingNameConflictPayload.name}</span>» уже существует в базе данных.
                            <br /><br />
                            Перезапишите существующий тест или вернитесь назад, чтобы ввести другое название.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                data-testid="NameConflictRenameButton"
                                onClick={cancelNameConflict}
                                className="px-4 py-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
                            >
                                Переименовать
                            </button>
                            <button
                                data-testid="NameConflictOverwriteButton"
                                onClick={confirmNameOverwrite}
                                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-lg shadow-amber-900/20 transition-colors flex items-center gap-2"
                            >
                                {isSaving ? <span className="animate-spin">⏳</span> : <Save className="w-4 h-4" />}
                                Перезаписать
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

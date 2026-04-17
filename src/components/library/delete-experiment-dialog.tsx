import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface DeleteExperimentDialogProps {
    /** The experiment to delete, or null when the dialog should be closed. */
    target: { id: string; name: string } | null;
    isDeleting: boolean;
    error: string | null;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Shared delete-confirmation dialog for experiments.
 *
 * Replaces the duplicate inline Dialog implementations that existed in both
 * ExperimentList (grid view) and ExperimentTable (list view).
 */
export function DeleteExperimentDialog({
    target,
    isDeleting,
    error,
    onConfirm,
    onCancel,
}: DeleteExperimentDialogProps) {
    return (
        <Dialog
            open={!!target}
            onOpenChange={(open) => { if (!open) onCancel(); }}
        >
            <DialogContent className="sm:max-w-[425px] bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Удаление отчёта</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Вы собираетесь удалить &quot;{target?.name}&quot;. Это действие нельзя отменить.
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <div className="px-1">
                        <p className="text-xs text-red-400">{error}</p>
                    </div>
                )}
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={onCancel}
                        disabled={isDeleting}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        Отмена
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                    >
                        {isDeleting ? 'Удаление...' : 'Удалить'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface LocalComparisonSaveConfirmDialogProps {
    open: boolean;
    language: 'ru' | 'en';
    count: number;
    fileNames: string[];
    onConfirm: () => void;
    onCancel: () => void;
}

export function LocalComparisonSaveConfirmDialog({
    open,
    language,
    count,
    fileNames,
    onConfirm,
    onCancel,
}: LocalComparisonSaveConfirmDialogProps) {
    const visibleNames = fileNames.slice(0, 5);
    const hiddenCount = Math.max(0, fileNames.length - visibleNames.length);

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}
        >
            <DialogContent
                className="sm:max-w-[460px] bg-card border-border text-foreground"
                data-testid="LocalComparisonSaveConfirmDialog"
            >
                <DialogHeader>
                    <DialogTitle>
                        {language === 'ru' ? 'Сохранить локальные файлы?' : 'Save local files?'}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        {language === 'ru'
                            ? `Для экспорта нужно сохранить ${count} локальных файлов в базу данных.`
                            : `To export, save ${count} local files to the database.`}
                    </DialogDescription>
                </DialogHeader>

                {visibleNames.length > 0 && (
                    <div className="rounded-lg border border-border bg-background/60 p-3">
                        <ul className="space-y-1 text-xs text-muted-foreground">
                            {visibleNames.map((name) => (
                                <li key={name} className="truncate" title={name}>
                                    {name}
                                </li>
                            ))}
                            {hiddenCount > 0 && (
                                <li>
                                    {language === 'ru'
                                        ? `И ещё ${hiddenCount}`
                                        : `And ${hiddenCount} more`}
                                </li>
                            )}
                        </ul>
                    </div>
                )}

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={onCancel}
                        data-testid="LocalComparisonSaveCancelButton"
                    >
                        {language === 'ru' ? 'Отмена' : 'Cancel'}
                    </Button>
                    <Button
                        onClick={onConfirm}
                        data-testid="LocalComparisonSaveConfirmButton"
                    >
                        {language === 'ru' ? 'Сохранить и экспортировать' : 'Save and export'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

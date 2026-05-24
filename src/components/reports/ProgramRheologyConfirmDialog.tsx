import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ProgramRheologyConfirmDialogProps {
    open: boolean;
    language: 'ru' | 'en';
    onConfirm: () => void;
    onCancel: () => void;
}

export function ProgramRheologyConfirmDialog({
    open,
    language,
    onConfirm,
    onCancel,
}: ProgramRheologyConfirmDialogProps) {
    const isRu = language === 'ru';

    return (
        <AlertDialog open={open} onOpenChange={(nextOpen) => {
            if (!nextOpen) onCancel();
        }}>
            <AlertDialogContent data-testid="ProgramRheologyConfirmDialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {isRu ? 'Подтвердите расчётную таблицу' : 'Confirm calculated rheology table'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {isRu
                            ? 'В отчёт будет загружена расчётная таблица реологии, рассчитанная программой по сырым данным и текущим настройкам анализа.'
                            : 'The report will include the rheology table calculated by the program from raw data and current analysis settings.'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={onCancel}>
                        {isRu ? 'Отмена' : 'Cancel'}
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>
                        {isRu ? 'ОК' : 'OK'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

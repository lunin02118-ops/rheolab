import { useEffect, lazy, Suspense } from 'react';
import { useLicense } from '@/hooks/useLicense';

const LicenseActivationDialog = lazy(() =>
    import('./LicenseActivationDialog').then(m => ({ default: m.LicenseActivationDialog }))
);

export function LicenseGuard() {
    const { result, isLoading, isInitialized } = useLicense();

    // Статусы, при которых блокируется работа
    const isBlocked = result?.status === 'expired'
        || result?.status === 'demo_expired'
        || result?.status === 'invalid';

    // Блокируем скролл если заблокировано
    useEffect(() => {
        if (isBlocked && isInitialized) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isBlocked, isInitialized]);

    // Не показываем блокировку пока идёт загрузка
    if (isLoading || !isInitialized) {
        return null;
    }

    if (!isBlocked) {
        return null;
    }

    // Определяем сообщение для разных случаев
    const message = result?.status === 'invalid'
        ? result?.message || 'Для активации пробной версии требуется подключение к интернету!'
        : undefined;

    return (
        <Suspense fallback={null}>
            <LicenseActivationDialog
                open={true}
                onOpenChange={() => { }} // Запрещаем закрытие
                forceBlock={true}
                blockMessage={message}
            />
        </Suspense>
    );
}

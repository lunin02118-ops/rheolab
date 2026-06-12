import React, { useCallback, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
    Copy,
    ExternalLink,
    Globe,
    Info,
    Mail,
    MessageCircle,
    Phone,
    Video,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { APP_VERSION, BUILD_DATE, COMMIT_HASH } from '@/lib/version';
import { cn } from '@/lib/utils';
import { LicenseActivationPanel } from '@/components/licensing/LicenseActivationDialog';
import maxQr from '@/assets/support/max-vladimir-qr.png';
import videosQr from '@/assets/support/rheolab-videos-qr.png';

type AboutTab = 'about' | 'license';

interface AboutProgramDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialTab?: AboutTab;
}

const WEBSITE_URL = 'https://rheolab.site/';
const VIDEOS_URL = 'https://rheolab.site/#videos';
const SUPPORT_EMAIL = 'support@rheolab.site';
const SALES_EMAIL = 'info@rheolab.site';
const MAX_URL = 'https://max.ru/u/f9LHodD0cOLW63HIbnNK90e5lAP3IS6U_IUOXd6wLaSn6rG1aA2-zACiIUE';

const CONTACTS = [
    {
        label: 'Техническая поддержка',
        value: SUPPORT_EMAIL,
        href: `mailto:${SUPPORT_EMAIL}`,
        copyLabel: 'Email поддержки скопирован',
        icon: Mail,
    },
    {
        label: 'Коммерческие вопросы и лицензии',
        value: SALES_EMAIL,
        href: `mailto:${SALES_EMAIL}`,
        copyLabel: 'Email для лицензий скопирован',
        icon: Mail,
    },
    {
        label: 'Телефон 1',
        value: '+7 705 803 08 63',
        href: 'tel:+77058030863',
        copyValue: '+77058030863',
        copyLabel: 'Телефон скопирован',
        icon: Phone,
    },
    {
        label: 'Телефон 2',
        value: '+7 982 880 18 22',
        href: 'tel:+79828801822',
        copyValue: '+79828801822',
        copyLabel: 'Телефон скопирован',
        icon: Phone,
    },
];

export function AboutProgramDialog({
    open,
    onOpenChange,
    initialTab = 'about',
}: AboutProgramDialogProps) {
    const [activeTab, setActiveTab] = useState<AboutTab>(initialTab);
    const [actionStatus, setActionStatus] = useState<string | null>(null);
    const [prevOpenState, setPrevOpenState] = useState({ open, initialTab });

    if (prevOpenState.open !== open || (open && prevOpenState.initialTab !== initialTab)) {
        setPrevOpenState({ open, initialTab });
        if (open) {
            setActiveTab(initialTab);
            setActionStatus(null);
        }
    }

    const copyValue = useCallback(async (value: string, message = 'Скопировано') => {
        try {
            await navigator.clipboard.writeText(value);
            setActionStatus(message);
        } catch (_error) {
            setActionStatus('Не удалось скопировать');
        }
    }, []);

    const openOrCopy = useCallback(async (href: string, fallbackMessage: string) => {
        try {
            await openUrl(href);
            setActionStatus(null);
        } catch (_error) {
            await copyValue(href, fallbackMessage);
        }
    }, [copyValue]);

    const handleTabChange = (value: string) => {
        setActiveTab(value as AboutTab);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Info className="h-5 w-5" />
                        О программе
                    </DialogTitle>
                    <DialogDescription>
                        Версия, поддержка, обучение и лицензия RheoLab Enterprise
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="about">О программе</TabsTrigger>
                        <TabsTrigger value="license">Лицензия</TabsTrigger>
                    </TabsList>

                    <TabsContent value="about" className="space-y-5 pt-3">
                        <section className="space-y-2">
                            <div>
                                <h2 className="text-xl font-semibold text-foreground">RheoLab Enterprise</h2>
                                <p className="text-sm text-muted-foreground">
                                    Профессиональный анализ реологических данных
                                </p>
                            </div>
                            <div className="grid gap-2 text-sm sm:grid-cols-3">
                                <VersionField label="Версия" value={APP_VERSION} />
                                {BUILD_DATE !== 'dev' && <VersionField label="Сборка" value={BUILD_DATE} />}
                                {COMMIT_HASH !== 'dev' && <VersionField label="Коммит" value={COMMIT_HASH} />}
                            </div>
                        </section>

                        <section className="space-y-3" aria-labelledby="about-quick-actions">
                            <SectionTitle id="about-quick-actions" icon={Video} title="Быстрые действия" />
                            <div className="grid gap-2 sm:grid-cols-2">
                                <ActionButton
                                    icon={Video}
                                    label="Обучающие видео"
                                    onClick={() => openOrCopy(VIDEOS_URL, 'Ссылка на видео скопирована')}
                                />
                                <ActionButton
                                    icon={Mail}
                                    label="Написать в поддержку"
                                    variant="outline"
                                    onClick={() => openOrCopy(`mailto:${SUPPORT_EMAIL}`, 'Email поддержки скопирован')}
                                />
                                <ActionButton
                                    icon={Mail}
                                    label="Коммерческие вопросы"
                                    variant="outline"
                                    onClick={() => openOrCopy(`mailto:${SALES_EMAIL}`, 'Email для лицензий скопирован')}
                                />
                                <ActionButton
                                    icon={MessageCircle}
                                    label="Открыть MAX"
                                    variant="outline"
                                    onClick={() => openOrCopy(MAX_URL, 'Ссылка MAX скопирована')}
                                />
                                <ActionButton
                                    icon={Globe}
                                    label="Открыть сайт"
                                    variant="secondary"
                                    className="sm:col-span-2"
                                    onClick={() => openOrCopy(WEBSITE_URL, 'Ссылка на сайт скопирована')}
                                />
                            </div>
                        </section>

                        <section className="space-y-3" aria-labelledby="about-qr-codes">
                            <SectionTitle id="about-qr-codes" icon={MessageCircle} title="QR-коды" />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <QrTile
                                    title="Связаться в MAX"
                                    caption="Наведите камеру телефона"
                                    urlLabel={MAX_URL}
                                    imageSrc={maxQr}
                                    imageAlt="QR-код MAX для связи с поддержкой RheoLab"
                                    onOpen={() => openOrCopy(MAX_URL, 'Ссылка MAX скопирована')}
                                    onCopy={() => copyValue(MAX_URL, 'Ссылка MAX скопирована')}
                                />
                                <QrTile
                                    title="Обучающие видео"
                                    caption="Откроет раздел видео на сайте"
                                    urlLabel={VIDEOS_URL}
                                    imageSrc={videosQr}
                                    imageAlt="QR-код раздела обучающих видео RheoLab"
                                    onOpen={() => openOrCopy(VIDEOS_URL, 'Ссылка на видео скопирована')}
                                    onCopy={() => copyValue(VIDEOS_URL, 'Ссылка на видео скопирована')}
                                />
                            </div>
                        </section>

                        <section className="space-y-3" aria-labelledby="about-contacts">
                            <SectionTitle id="about-contacts" icon={Phone} title="Контакты" />
                            <div className="space-y-2">
                                {CONTACTS.map(contact => (
                                    <ContactRow
                                        key={contact.label}
                                        label={contact.label}
                                        value={contact.value}
                                        icon={contact.icon}
                                        onOpen={() => openOrCopy(contact.href, contact.copyLabel)}
                                        onCopy={() => copyValue(contact.copyValue ?? contact.value, contact.copyLabel)}
                                    />
                                ))}
                            </div>
                        </section>

                        {actionStatus && (
                            <div className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground">
                                {actionStatus}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="license" className="pt-3">
                        <LicenseActivationPanel
                            onClose={() => onOpenChange(false)}
                            active={open && activeTab === 'license'}
                        />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

function VersionField({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="break-all font-mono text-xs text-foreground">{value}</div>
        </div>
    );
}

function SectionTitle({
    id,
    icon: Icon,
    title,
}: {
    id: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
}) {
    return (
        <h3 id={id} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
        </h3>
    );
}

function ActionButton({
    icon: Icon,
    label,
    onClick,
    variant = 'default',
    className,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    variant?: 'default' | 'outline' | 'secondary';
    className?: string;
}) {
    return (
        <Button
            type="button"
            variant={variant}
            className={cn('min-h-10 justify-start whitespace-normal text-left', className)}
            onClick={onClick}
        >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
        </Button>
    );
}

function QrTile({
    title,
    caption,
    urlLabel,
    imageSrc,
    imageAlt,
    onOpen,
    onCopy,
}: {
    title: string;
    caption: string;
    urlLabel: string;
    imageSrc: string;
    imageAlt: string;
    onOpen: () => void;
    onCopy: () => void;
}) {
    return (
        <div className="rounded-md border border-border bg-secondary/20 p-3">
            <div className="grid gap-3 sm:grid-cols-[128px_1fr]">
                <img
                    src={imageSrc}
                    alt={imageAlt}
                    className="h-32 w-32 rounded-md border border-border bg-white p-2"
                />
                <div className="min-w-0 space-y-2">
                    <div>
                        <div className="font-medium text-foreground">{title}</div>
                        <div className="text-sm text-muted-foreground">{caption}</div>
                    </div>
                    <div className="break-all font-mono text-xs text-muted-foreground">{urlLabel}</div>
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={onOpen}>
                            <ExternalLink className="h-4 w-4" />
                            Открыть
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={onCopy}>
                            <Copy className="h-4 w-4" />
                            Скопировать
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ContactRow({
    label,
    value,
    icon: Icon,
    onOpen,
    onCopy,
}: {
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    onOpen: () => void;
    onCopy: () => void;
}) {
    return (
        <div className="grid gap-2 rounded-md border border-border bg-secondary/20 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {label}
                </div>
                <div className="break-all pl-6 text-sm text-muted-foreground">{value}</div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button type="button" size="sm" variant="outline" onClick={onOpen}>
                    <ExternalLink className="h-4 w-4" />
                    Открыть
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onCopy}>
                    <Copy className="h-4 w-4" />
                    Скопировать
                </Button>
            </div>
        </div>
    );
}

export default AboutProgramDialog;

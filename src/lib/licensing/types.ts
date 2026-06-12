/**
 * Licensing System Types
 * RheoLab Enterprise
 */

// ==================== License Types ====================

/**
 * License tiers, ordered roughly by privilege level.
 *
 * Update-channel mapping (handled server-side by `get_update_channel`):
 * - `superuser` → `alpha`   (project owner's personal tier — pre-release QA)
 * - `developer` → `beta`    (internal dev team)
 * - everything else → `stable`
 */
export type LicenseType = 'demo' | 'trial' | 'corporate' | 'developer' | 'superuser';

export type LicenseStatus =
    | 'active'           // Полная лицензия активна
    | 'grace'            // Grace period (после истечения)
    | 'demo'             // Demo режим (30 дней)
    | 'demo_expired'     // Demo истёк
    | 'expired'          // Лицензия истекла
    | 'invalid';         // Невалидная лицензия

export type LicenseSource =
    | 'key'              // Активация по ключу
    | 'unlicensed'       // Лицензия не активирована
    | 'demo';            // Demo режим

// ==================== License Features ====================

export interface LicenseFeatures {
    maxExperiments: number;     // -1 = unlimited
    maxComparisonExperiments: number; // Максимум графиков в сравнении (3 для trial, 8 для corporate/developer)
    exportPdf: boolean;
    exportExcel: boolean;
    aiParsing: boolean;
    comparison: boolean;
    watermark: boolean;         // Требуется водяной знак на отчётах

    // Developer features ONLY
    calibrationAnalysis: boolean;      // Анализ калибровки реометров (только developer)
    calibrationParsing: boolean;       // Парсинг данных калибровки (только developer)
    chandler5550Support: boolean;      // Поддержка Chandler 5550
    bslR1Support: boolean;             // Поддержка BSL R1 калибровки
}

// ==================== License ====================

export interface License {
    id: string;
    type: LicenseType;
    customerName: string;
    email?: string;

    // Сроки
    issuedAt: Date;
    expiresAt?: Date;
    gracePeriodDays: number;

    // Привязка
    machineId?: string;         // Для corporate лицензий
    seats?: number;             // Зарезервировано для корпоративных договоров

    // Возможности
    features: LicenseFeatures;
}

// ==================== License Result ====================

export interface LicenseResult {
    status: LicenseStatus;
    source: LicenseSource;
    license?: License;

    // Информация о сроках
    daysRemaining?: number;
    experimentsRemaining?: number;

    // Сообщения
    message?: string;
    showWarning?: boolean;

    // Ключ (для отображения)
    key?: string;
}

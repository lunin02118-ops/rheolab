/**
 * Licensing System Types
 * RheoLab Enterprise
 */

// ==================== License Types ====================

export type LicenseType = 'demo' | 'trial' | 'standard' | 'enterprise' | 'developer';

export type LicenseStatus =
    | 'active'           // Полная лицензия активна
    | 'grace'            // Grace period (после истечения)
    | 'demo'             // Demo режим (30 дней)
    | 'demo_expired'     // Demo истёк
    | 'expired'          // Лицензия истекла
    | 'invalid';         // Невалидная лицензия

export type LicenseSource =
    | 'key'              // Активация по ключу
    | 'demo';            // Demo режим

// ==================== License Features ====================

export interface LicenseFeatures {
    maxExperiments: number;     // -1 = unlimited
    maxComparisonExperiments: number; // Максимум графиков в режиме сравнения (3 для standard, 8 для developer)
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
    expiresAt: Date;
    gracePeriodDays: number;

    // Привязка
    machineId?: string;         // Для standard лицензий
    seats?: number;             // Для enterprise

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



// ==================== Constants ====================

export const DEMO_LIMITS = {
    maxDays: 30,
    maxExperiments: 10,  // Максимум экспериментов в БД для Demo версии
};

export const GRACE_PERIOD_DAYS = 30;

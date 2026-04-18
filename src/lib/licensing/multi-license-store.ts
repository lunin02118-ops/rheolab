/**
 * Multi-License Store
 * 
 * Хранилище для нескольких лицензий (режим разработчика/тестирования)
 * Позволяет переключаться между разными типами лицензий для тестирования функционала
 */

import { encrypt, decrypt } from '@/lib/utils/encryption';
import { logger } from '@/lib/logger';
import { isProduction } from '@/lib/env';
import type { License } from './types';

// ==================== Types ====================

export interface LicenseSlot {
    id: string;                  // Уникальный ID слота
    key: string;                 // Ключ лицензии
    license: License;            // Данные лицензии
    signature: string;           // Подпись сервера
    rawData: string;             // Сырые данные для проверки подписи
    activatedAt: Date;           // Дата активации
    label?: string;              // Метка для удобства ("Standard Test", "Enterprise")
}

export interface MultiLicenseState {
    slots: LicenseSlot[];        // Все активированные лицензии
    activeSlotId: string | null; // ID активного слота
    devModeEnabled: boolean;     // Включен ли режим разработчика
}

// ==================== Constants ====================

const STORAGE_KEY = 'rheolab_multi_license_state';
const DEV_MODE_KEY = 'rheolab_dev_mode';

function createSlotId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `slot-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ==================== State Management ====================

/**
 * Загрузить состояние мульти-лицензий
 */
export function loadMultiLicenseState(): MultiLicenseState | null {
    try {
        const encrypted = localStorage.getItem(STORAGE_KEY);
        if (!encrypted) return null;

        const data = decrypt(encrypted);
        if (data === 'DECRYPTION_ERROR') return null;

        const state = JSON.parse(data) as MultiLicenseState;
        
        // Восстановить даты
        state.slots = state.slots.map(slot => ({
            ...slot,
            activatedAt: new Date(slot.activatedAt),
            license: {
                ...slot.license,
                issuedAt: new Date(slot.license.issuedAt),
                expiresAt: new Date(slot.license.expiresAt),
            }
        }));

        return state;
    } catch (error) {
        console.error('[MultiLicenseStore] Failed to load state:', error);
        return null;
    }
}

/**
 * Сохранить состояние мульти-лицензий
 */
export function saveMultiLicenseState(state: MultiLicenseState): void {
    try {
        const data = JSON.stringify(state);
        const encrypted = encrypt(data);
        localStorage.setItem(STORAGE_KEY, encrypted);
        logger.debug('[MultiLicenseStore] State saved, slots:', state.slots.length);
    } catch (error) {
        console.error('[MultiLicenseStore] Failed to save state:', error);
    }
}

/**
 * Инициализировать пустое состояние
 */
export function initMultiLicenseState(): MultiLicenseState {
    return {
        slots: [],
        activeSlotId: null,
        devModeEnabled: false,
    };
}

// ==================== Slot Operations ====================

/**
 * Добавить лицензию в слот
 */
export function addLicenseSlot(
    key: string,
    license: License,
    signature: string,
    rawData: string,
    label?: string
): LicenseSlot {
    const state = loadMultiLicenseState() || initMultiLicenseState();
    
    // Проверить, нет ли уже такого ключа
    const existingIndex = state.slots.findIndex(s => s.key === key);
    if (existingIndex !== -1) {
        // Обновить существующий слот
        state.slots[existingIndex] = {
            ...state.slots[existingIndex],
            license,
            signature,
            rawData,
            activatedAt: new Date(),
            label: label || state.slots[existingIndex].label,
        };
        saveMultiLicenseState(state);
        return state.slots[existingIndex];
    }

    // Создать новый слот
    const slot: LicenseSlot = {
        id: createSlotId(),
        key,
        license,
        signature,
        rawData,
        activatedAt: new Date(),
        label: label || `${license.type} (${license.customerName})`,
    };

    state.slots.push(slot);
    
    // Если это первый слот, сделать его активным
    if (state.slots.length === 1) {
        state.activeSlotId = slot.id;
    }

    saveMultiLicenseState(state);
    return slot;
}

/**
 * Удалить слот лицензии
 */
export function removeLicenseSlot(slotId: string): boolean {
    const state = loadMultiLicenseState();
    if (!state) return false;

    const index = state.slots.findIndex(s => s.id === slotId);
    if (index === -1) return false;

    state.slots.splice(index, 1);

    // Если удалили активный слот, переключиться на первый доступный
    if (state.activeSlotId === slotId) {
        state.activeSlotId = state.slots.length > 0 ? state.slots[0].id : null;
    }

    saveMultiLicenseState(state);
    return true;
}

/**
 * Переключить активный слот
 */
export function setActiveSlot(slotId: string): boolean {
    const state = loadMultiLicenseState();
    if (!state) return false;

    const slot = state.slots.find(s => s.id === slotId);
    if (!slot) return false;

    state.activeSlotId = slotId;
    saveMultiLicenseState(state);
    
    logger.debug('[MultiLicenseStore] Active slot changed to:', slot.label || slot.license.type);
    return true;
}

/**
 * Получить активный слот
 */
export function getActiveSlot(): LicenseSlot | null {
    const state = loadMultiLicenseState();
    if (!state || !state.activeSlotId) return null;

    return state.slots.find(s => s.id === state.activeSlotId) || null;
}

/**
 * Получить все слоты
 */
export function getAllSlots(): LicenseSlot[] {
    const state = loadMultiLicenseState();
    return state?.slots || [];
}

// ==================== Dev Mode ====================

/**
 * Проверить включен ли режим разработчика
 */
export function isDevModeEnabled(): boolean {
    // В production режиме всегда false
    if (isProduction) {
        return false;
    }
    
    try {
        return localStorage.getItem(DEV_MODE_KEY) === 'true';
    } catch (_e) {
        return false;
    }
}

/**
 * Включить/выключить режим разработчика
 */
export function setDevMode(enabled: boolean): void {
    if (isProduction) {
        console.warn('[MultiLicenseStore] Dev mode cannot be enabled in production');
        return;
    }

    try {
        if (enabled) {
            localStorage.setItem(DEV_MODE_KEY, 'true');
            logger.debug('[MultiLicenseStore] Dev mode ENABLED');
        } else {
            localStorage.removeItem(DEV_MODE_KEY);
            logger.debug('[MultiLicenseStore] Dev mode DISABLED');
        }
    } catch (error) {
        console.error('[MultiLicenseStore] Failed to set dev mode:', error);
    }
}

/**
 * Очистить все данные мульти-лицензий
 */
export function clearMultiLicenseData(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(DEV_MODE_KEY);
        logger.debug('[MultiLicenseStore] All multi-license data cleared');
    } catch (error) {
        console.error('[MultiLicenseStore] Failed to clear multi-license data:', error);
    }
}

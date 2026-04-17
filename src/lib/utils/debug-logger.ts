/* eslint-disable no-console -- This IS the debug console logging layer */
/**
 * Debug Logger
 * 
 * Feature-flagged логирование для замены console.log.
 * Логи выводятся только при DEBUG=true или NODE_ENV=development.
 * 
 * Использование:
 * ```ts
 * import { debugLog, debugWarn } from '@/lib/utils/debug-logger';
 * debugLog('LicenseStore', 'Initialized:', result);
 * debugWarn('Parser', 'Unknown format');
 * ```
 */

/**
 * Проверяет, включен ли debug режим
 */
export function isDebugEnabled(): boolean {
  // В браузере (Vite env)
  if (typeof window !== 'undefined') {
    return (
      import.meta.env.DEV ||
      import.meta.env.VITE_DEBUG === 'true' ||
      localStorage.getItem('DEBUG') === 'true'
    );
  }
  
  // Fallback для SSR/Node.js контекста (не используется в Tauri)
  return false;
}

/**
 * Debug log - выводит только в debug режиме
 * @param category - категория/модуль (например 'LicenseStore', 'WasmEngine')
 * @param args - аргументы для логирования
 */
export function debugLog(category: string, ...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log(`[${category}]`, ...args);
  }
}

/**
 * Debug warn - выводит только в debug режиме
 * @param category - категория/модуль
 * @param args - аргументы для логирования
 */
export function debugWarn(category: string, ...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.warn(`[${category}]`, ...args);
  }
}

/**
 * Debug error - выводит ВСЕГДА (ошибки важны)
 * @param category - категория/модуль
 * @param args - аргументы для логирования
 */
export function debugError(category: string, ...args: unknown[]): void {
  // Ошибки выводим всегда
  console.error(`[${category}]`, ...args);
}

/**
 * Debug info - выводит только в debug режиме
 * @param category - категория/модуль
 * @param args - аргументы для логирования
 */
export function debugInfo(category: string, ...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.info(`[${category}]`, ...args);
  }
}

/**
 * Включить debug режим программно (для браузера)
 */
export function enableDebug(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('DEBUG', 'true');
  }
}

/**
 * Выключить debug режим программно (для браузера)
 */
export function disableDebug(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('DEBUG');
  }
}

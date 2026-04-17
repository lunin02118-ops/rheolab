/**
 * Encryption Utilities
 * 
 * Server-side uses Node crypto with LICENSE_ENCRYPTION_KEY (secure)
 * Client-side uses simple obfuscation (for localStorage cache only)
 * 
 * IMPORTANT: Sensitive data should be stored in server-side database,
 * not in localStorage. LocalStorage is only for UI cache.
 */

import { isDevelopment, isTest } from '@/lib/env';

// Check if we're on server or client
const isServer = typeof window === 'undefined';

// Import crypto module for server-side use (will be undefined on client)
if (isServer) {
    // Dynamic import for server-side only
    import('crypto').catch(() => { });
}

// ==================== SERVER-SIDE ENCRYPTION (SECURE) ====================

/**
 * Get encryption key from SERVER-ONLY environment variable
 */
function getServerEncryptionKey(): string {
    // Use server-only variable (not exposed to client)
    const key = process.env.LICENSE_ENCRYPTION_KEY;

    if (!key) {
        if (isDevelopment || isTest) {
            console.warn('[Encryption] LICENSE_ENCRYPTION_KEY missing, using dev fallback');
            return 'development-server-only-key-32!';
        }
        throw new Error('[Encryption] LICENSE_ENCRYPTION_KEY is required in production');
    }

    if (key.length < 32) {
        throw new Error('[Encryption] LICENSE_ENCRYPTION_KEY must be at least 32 characters');
    }

    return key.substring(0, 32);
}

/**
 * Server-side encryption using Node.js crypto
 */
function serverEncrypt(text: string): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto') as typeof import('crypto');
    const ALGORITHM = 'aes-256-cbc';
    const IV_LENGTH = 16;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(getServerEncryptionKey()), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Server-side decryption using Node.js crypto
 */
function serverDecrypt(text: string): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const crypto = require('crypto') as typeof import('crypto');
        const ALGORITHM = 'aes-256-cbc';

        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift()!, 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(getServerEncryptionKey()), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        console.error('[Encryption] Server decryption failed:', error);
        return 'DECRYPTION_ERROR';
    }
}

// ==================== CLIENT-SIDE OBFUSCATION (FOR CACHE ONLY) ====================

/**
 * Simple XOR-based obfuscation for client-side localStorage.
 * NOT cryptographically secure - only for obfuscating cached data.
 * Real security comes from server-side validation and protected DB storage.
 */
const CLIENT_OBFUSCATION_KEY = 'RheoLab2025ClientCache';

/**
 * Convert string to Uint8Array (UTF-8)
 */
function stringToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

/**
 * Convert Uint8Array to string (UTF-8)
 */
function bytesToString(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

/**
 * Convert Uint8Array to base64
 */
function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert base64 to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function clientObfuscate(text: string): string {
    const keyBytes = stringToBytes(CLIENT_OBFUSCATION_KEY);
    const textBytes = stringToBytes(text);
    const result = new Uint8Array(textBytes.length);

    for (let i = 0; i < textBytes.length; i++) {
        result[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
    }

    return 'OBF:' + bytesToBase64(result);
}

function clientDeobfuscate(encoded: string): string {
    try {
        if (!encoded.startsWith('OBF:')) {
            // Try legacy format (old encrypted data)
            return encoded;
        }
        const dataBytes = base64ToBytes(encoded.substring(4));
        const keyBytes = stringToBytes(CLIENT_OBFUSCATION_KEY);
        const result = new Uint8Array(dataBytes.length);

        for (let i = 0; i < dataBytes.length; i++) {
            result[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
        }

        return bytesToString(result);
    } catch (error) {
        console.error('[Encryption] Client deobfuscation failed:', error);
        return 'DECRYPTION_ERROR';
    }
}

// ==================== UNIFIED API ====================

/**
 * Encrypts data - uses appropriate method for environment
 */
export function encrypt(text: string): string {
    if (isServer) {
        return serverEncrypt(text);
    }
    // Client-side: use simple obfuscation (not real encryption)
    return clientObfuscate(text);
}

/**
 * Decrypts data - uses appropriate method for environment
 */
export function decrypt(text: string): string {
    if (isServer) {
        // Try server decryption first
        if (!text.startsWith('OBF:')) {
            return serverDecrypt(text);
        }
        // Fall back to client obfuscation format
        return clientDeobfuscate(text);
    }
    // Client-side
    if (text.startsWith('OBF:')) {
        return clientDeobfuscate(text);
    }
    // Legacy encrypted data - can't decrypt on client anymore
    console.warn('[Encryption] Legacy encrypted data detected, returning as-is');
    return text;
}

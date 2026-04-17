import { describe, expect, it } from 'vitest';
import { TauriError } from '@/lib/tauri/errors';

// ---------------------------------------------------------------------------
// TauriError — pure synchronous logic; no Tauri runtime required
// ---------------------------------------------------------------------------

describe('TauriError — constructor', () => {
    it('sets name to TauriError', () => {
        const err = new TauriError('Pool error: oops');
        expect(err.name).toBe('TauriError');
    });

    it('sets message from string raw value', () => {
        const err = new TauriError('Database pool error: timeout');
        expect(err.message).toBe('Database pool error: timeout');
    });

    it('sets message from Error instance', () => {
        const inner = new Error('inner message');
        const err = new TauriError(inner);
        expect(err.message).toBe('inner message');
    });

    it('sets message from non-string, non-Error raw value via String()', () => {
        const err = new TauriError({ code: 42 });
        expect(err.message).toBe('[object Object]');
    });

    it('stores original raw value', () => {
        const raw = 'raw string';
        const err = new TauriError(raw);
        expect(err.raw).toBe(raw);
    });

    it('stores Error instance as raw', () => {
        const inner = new Error('boom');
        const err = new TauriError(inner);
        expect(err.raw).toBe(inner);
    });

    it('is instanceof Error', () => {
        const err = new TauriError('something');
        expect(err).toBeInstanceOf(Error);
    });

    it('is instanceof TauriError', () => {
        const err = new TauriError('something');
        expect(err).toBeInstanceOf(TauriError);
    });
});

// ---------------------------------------------------------------------------
// detectKind — via constructor (private method, exercised through kind)
//
// Since safe_message() (S-4), Rust no longer exposes internal prefixes in the
// IPC message string.  Kind detection for plain strings is intentionally
// reduced to the LICENSE_REQUIRED sentinel only.  All other plain strings
// map to 'Other'; the structured {kind, message} envelope is the only
// reliable way to obtain a specific kind (see the envelope section below).
// ---------------------------------------------------------------------------

describe('TauriError — kind classification', () => {
    // All safe-message strings produced by Rust are now opaque → Other.
    const safeMsgCases: Array<[string]> = [
        ['Database temporarily unavailable'],  // Pool safe message
        ['Database error'],                    // Sql safe message
        ['File operation failed'],             // Io safe message
        ['Internal processing error'],         // Join safe message
        ['Data format error'],                 // Serde safe message
        ['Network error'],                     // Http safe message
        // BadRequest / License / Parse pass their msg through, but a raw
        // string without an envelope still resolves to Other
        ['Bad request: missing field'],
        ['License error: expired'],
        ['Parse error: invalid number'],
        // Old raw Rust prefixes (pre-safe_message) must also be Other now
        ['Database pool error: timeout'],
        ['SQL error: no such table'],
        ['I/O error: file not found'],
        ['Task join error: cancelled'],
        ['Serialization error: bad json'],
        ['HTTP error: 503'],
    ];

    it.each(safeMsgCases)('plain string "%s" classifies as Other', (message) => {
        const err = new TauriError(message);
        expect(err.kind).toBe('Other');
    });

    it('classifies LICENSE_REQUIRED sentinel as License', () => {
        const err = new TauriError('LICENSE_REQUIRED');
        expect(err.kind).toBe('License');
    });

    it('classifies unknown message as Other', () => {
        const err = new TauriError('something completely unexpected');
        expect(err.kind).toBe('Other');
    });

    it('classifies empty string as Other', () => {
        const err = new TauriError('');
        expect(err.kind).toBe('Other');
    });

    it('is case-sensitive — lowercase prefix does not match', () => {
        // 'sql error: ...' is not the prefix 'SQL error: ...'
        const err = new TauriError('sql error: something');
        expect(err.kind).toBe('Other');
    });

    it('prefix must be at start — mid-string match is Other', () => {
        const err = new TauriError('wrapped SQL error: something');
        expect(err.kind).toBe('Other');
    });
});

// ---------------------------------------------------------------------------
// Convenience predicates
// ---------------------------------------------------------------------------

describe('TauriError — isLicenseError', () => {
    it('returns true for License kind via structured envelope', () => {
        expect(new TauriError({ kind: 'License', message: 'License error: x' }).isLicenseError).toBe(true);
    });

    it('returns true for LICENSE_REQUIRED sentinel', () => {
        expect(new TauriError('LICENSE_REQUIRED').isLicenseError).toBe(true);
    });

    it('returns false for non-License kind', () => {
        // Plain strings are Other, not License
        expect(new TauriError('License error: x').isLicenseError).toBe(false);
    });
});

describe('TauriError — isBadRequest', () => {
    it('returns true for BadRequest kind via structured envelope', () => {
        expect(new TauriError({ kind: 'BadRequest', message: 'Bad request: missing field' }).isBadRequest).toBe(true);
    });

    it('returns false for other kinds', () => {
        expect(new TauriError({ kind: 'Io', message: 'File operation failed' }).isBadRequest).toBe(false);
    });
});

describe('TauriError — isTransient', () => {
    it('returns true for Pool', () => {
        expect(new TauriError({ kind: 'Pool', message: 'Database temporarily unavailable' }).isTransient).toBe(true);
    });

    it('returns true for Io', () => {
        expect(new TauriError({ kind: 'Io', message: 'File operation failed' }).isTransient).toBe(true);
    });

    it('returns true for Http', () => {
        expect(new TauriError({ kind: 'Http', message: 'Network error' }).isTransient).toBe(true);
    });

    it('returns true for Join', () => {
        expect(new TauriError({ kind: 'Join', message: 'Internal processing error' }).isTransient).toBe(true);
    });

    it('returns false for Sql', () => {
        expect(new TauriError({ kind: 'Sql', message: 'Database error' }).isTransient).toBe(false);
    });

    it('returns false for License', () => {
        expect(new TauriError({ kind: 'License', message: 'License error: x' }).isTransient).toBe(false);
    });

    it('returns false for Other', () => {
        expect(new TauriError('something unknown').isTransient).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// TauriError.from() static factory
// ---------------------------------------------------------------------------

describe('TauriError.from()', () => {
    it('wraps a plain string as Other kind (no prefix detection)', () => {
        // Since safe_message(), plain strings no longer carry kind prefixes
        const err = TauriError.from('SQL error: bad query');
        expect(err).toBeInstanceOf(TauriError);
        expect(err.message).toBe('SQL error: bad query');
        expect(err.kind).toBe('Other');
    });

    it('wraps a native Error in a TauriError', () => {
        const native = new Error('oops');
        const err = TauriError.from(native);
        expect(err).toBeInstanceOf(TauriError);
        expect(err.message).toBe('oops');
    });

    it('does NOT double-wrap an existing TauriError', () => {
        const original = new TauriError('License error: required');
        const wrapped = TauriError.from(original);
        expect(wrapped).toBe(original);
    });

    it('wraps unknown/arbitrary values', () => {
        const err = TauriError.from(null);
        expect(err).toBeInstanceOf(TauriError);
        expect(err.message).toBe('null');
    });
});

// ---------------------------------------------------------------------------
// TauriError.isTauriError() type guard
// ---------------------------------------------------------------------------

describe('TauriError.isTauriError()', () => {
    it('returns true for a TauriError instance', () => {
        const err = new TauriError('Parse error: x');
        expect(TauriError.isTauriError(err)).toBe(true);
    });

    it('returns false for a native Error', () => {
        expect(TauriError.isTauriError(new Error('no'))).toBe(false);
    });

    it('returns false for a plain string', () => {
        expect(TauriError.isTauriError('SQL error: x')).toBe(false);
    });

    it('returns false for null', () => {
        expect(TauriError.isTauriError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(TauriError.isTauriError(undefined)).toBe(false);
    });

    it('returns true for from()-wrapped value', () => {
        const err = TauriError.from('I/O error: x');
        expect(TauriError.isTauriError(err)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Structured error envelope (new path — matches Rust {kind, message} format)
// ---------------------------------------------------------------------------

describe('TauriError — structured error envelope', () => {
    it('classifies structured {kind, message} as the correct kind', () => {
        const err = new TauriError({ kind: 'Sql', message: 'SQL error: no such table' });
        expect(err.kind).toBe('Sql');
        expect(err.message).toBe('SQL error: no such table');
    });

    it.each([
        ['Pool',       'Pool'],
        ['Sql',        'Sql'],
        ['Io',         'Io'],
        ['Join',       'Join'],
        ['Serde',      'Serde'],
        ['Http',       'Http'],
        ['BadRequest', 'BadRequest'],
        ['License',    'License'],
        ['Parse',      'Parse'],
        ['Other',      'Other'],
    ] as const)('maps Rust kind "%s" → TauriErrorKind "%s"', (rustKind, expected) => {
        const err = new TauriError({ kind: rustKind, message: `test msg for ${rustKind}` });
        expect(err.kind).toBe(expected);
    });

    it('maps unknown Rust kind to Other', () => {
        const err = new TauriError({ kind: 'FutureVariant', message: 'something new' });
        expect(err.kind).toBe('Other');
        expect(err.message).toBe('something new');
    });

    it('stores the envelope object as raw', () => {
        const raw = { kind: 'License', message: 'License error: required' };
        const err = new TauriError(raw);
        expect(err.raw).toBe(raw);
    });

    it('License envelope has isLicenseError = true', () => {
        const err = new TauriError({ kind: 'License', message: 'License error: required' });
        expect(err.isLicenseError).toBe(true);
    });

    it('BadRequest envelope has isBadRequest = true', () => {
        const err = new TauriError({ kind: 'BadRequest', message: 'Bad request: missing field' });
        expect(err.isBadRequest).toBe(true);
    });

    it('Pool envelope has isTransient = true', () => {
        const err = new TauriError({ kind: 'Pool', message: 'Database pool error: timeout' });
        expect(err.isTransient).toBe(true);
    });

    it('object missing kind falls through to legacy string path', () => {
        const err = new TauriError({ message: 'SQL error: bad query' });
        // No 'kind' field → not an envelope → legacy String() path
        expect(err.kind).toBe('Other');
    });

    it('object missing message falls through to legacy string path', () => {
        const err = new TauriError({ kind: 'Sql' });
        // No 'message' field → not an envelope → legacy String() path
        expect(err.kind).toBe('Other');
    });

    it('TauriError.from() wraps structured envelope correctly', () => {
        const err = TauriError.from({ kind: 'License', message: 'License error: required' });
        expect(err).toBeInstanceOf(TauriError);
        expect(err.kind).toBe('License');
        expect(err.isLicenseError).toBe(true);
    });
});

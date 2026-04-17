/**
 * TauriError — typed wrapper for Tauri IPC command errors.
 *
 * Tauri serialises `AppError` as a JSON object `{kind, message}` (see
 * `src-tauri/src/error.rs`).  When an IPC command rejects, the catch value
 * is that object.  `TauriError` wraps it in a proper `Error` subclass and
 * exposes `kind` so the UI can branch without fragile string matching.
 *
 * The `{kind, message}` envelope is always present for Tauri IPC errors.
 * The legacy plain-string path is kept only for non-Tauri exceptions that
 * may propagate through the same catch blocks (e.g. JS runtime errors).
 *
 * Usage:
 * ```ts
 * import { TauriError } from '@/lib/tauri/errors';
 *
 * try {
 *   await tauriApi.someCommand(args);
 * } catch (e) {
 *   const err = TauriError.from(e);
 *   if (err.kind === 'License') showUpgradePrompt();
 *   else setError(err.message);
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Kind enum — mirrors AppError variants in src-tauri/src/error.rs
// ---------------------------------------------------------------------------

export type TauriErrorKind =
    | 'Pool'         // AppError::Pool       — "Database temporarily unavailable"
    | 'Sql'          // AppError::Sql        — "Database error"
    | 'Io'           // AppError::Io         — "File operation failed"
    | 'Join'         // AppError::Join       — "Internal processing error"
    | 'Serde'        // AppError::Serde      — "Data format error"
    | 'Http'         // AppError::Http       — "Network error"
    | 'BadRequest'   // AppError::BadRequest — user-visible message
    | 'License'      // AppError::License    — user-visible message
    | 'Parse'        // AppError::Parse      — user-visible message
    | 'Other';       // AppError::Other or any non-structured exception

/** Well-known literal values returned by legacy command paths. */
const LICENSE_SENTINEL = 'LICENSE_REQUIRED';

// ---------------------------------------------------------------------------
// Structured error envelope (new path — matches Rust Serialize impl)
// ---------------------------------------------------------------------------

/** Shape emitted by the Rust `AppError` Serialize impl since B.1. */
interface ErrorEnvelope {
    kind: string;
    message: string;
}

/** Type guard for the structured `{kind, message}` envelope from Rust. */
function isErrorEnvelope(raw: unknown): raw is ErrorEnvelope {
    return (
        typeof raw === 'object' &&
        raw !== null &&
        'kind' in raw &&
        'message' in raw &&
        typeof (raw as ErrorEnvelope).kind === 'string' &&
        typeof (raw as ErrorEnvelope).message === 'string'
    );
}

/** Map the Rust kind string to a validated `TauriErrorKind`. */
const VALID_KINDS = new Set<TauriErrorKind>([
    'Pool', 'Sql', 'Io', 'Join', 'Serde', 'Http',
    'BadRequest', 'License', 'Parse', 'Other',
]);

function mapRustKind(kind: string): TauriErrorKind {
    return VALID_KINDS.has(kind as TauriErrorKind) ? (kind as TauriErrorKind) : 'Other';
}

// ---------------------------------------------------------------------------
// TauriError class
// ---------------------------------------------------------------------------

export class TauriError extends Error {
    /** Classified variant, mirrors Rust `AppError` enum. */
    readonly kind: TauriErrorKind;

    /** The original value thrown by the Tauri IPC layer (usually a string). */
    readonly raw: unknown;

    constructor(raw: unknown) {
        let message: string;
        let kind: TauriErrorKind;

        if (isErrorEnvelope(raw)) {
            // New structured path: Rust sends {kind, message}
            message = raw.message;
            kind = mapRustKind(raw.kind);
        } else {
            // Legacy path: plain string (or Error instance)
            message =
                typeof raw === 'string'
                    ? raw
                    : raw instanceof Error
                        ? raw.message
                        : String(raw);
            kind = TauriError.detectKind(message);
        }

        super(message);
        this.name = 'TauriError';
        this.raw = raw;
        this.kind = kind;

        // Preserve prototype chain for `instanceof` checks in transpiled code.
        Object.setPrototypeOf(this, TauriError.prototype);
    }

    // -----------------------------------------------------------------------
    // Static helpers
    // -----------------------------------------------------------------------

    /** Classify a plain-string error into a `TauriErrorKind`.
     * Used only for non-Tauri exceptions; Tauri IPC errors always carry
     * the structured `{kind, message}` envelope and bypass this path.
     */
    private static detectKind(message: string): TauriErrorKind {
        if (message === LICENSE_SENTINEL) return 'License';
        return 'Other';
    }

    /**
     * Wrap any unknown `catch` value as a `TauriError`.
     * If `e` is already a `TauriError` it is returned as-is (no double-wrap).
     */
    static from(e: unknown): TauriError {
        return e instanceof TauriError ? e : new TauriError(e);
    }

    /**
     * Type guard — returns `true` when `e` is a `TauriError`.
     * Prefer this over `instanceof` checks to work across module boundaries.
     */
    static isTauriError(e: unknown): e is TauriError {
        return e instanceof TauriError;
    }

    // -----------------------------------------------------------------------
    // Convenience predicates
    // -----------------------------------------------------------------------

    /** True for licensing gate errors (requires upgrade or activation). */
    get isLicenseError(): boolean {
        return this.kind === 'License';
    }

    /** True for caller-supplied invalid argument errors. */
    get isBadRequest(): boolean {
        return this.kind === 'BadRequest';
    }

    /** True for transient infrastructure errors (DB pool, IO, HTTP, tasks). */
    get isTransient(): boolean {
        return (
            this.kind === 'Pool' ||
            this.kind === 'Io' ||
            this.kind === 'Http' ||
            this.kind === 'Join'
        );
    }
}

// ---------------------------------------------------------------------------
// Convenience type guard (functional form, usable in .filter() etc.)
// ---------------------------------------------------------------------------

/** Returns `true` when `e` is a `TauriError`. */
export function isTauriError(e: unknown): e is TauriError {
    return TauriError.isTauriError(e);
}

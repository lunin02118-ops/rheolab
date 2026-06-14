const fs = require('fs');
const { spawnSync } = require('child_process');

const TRANSIENT_FS_ERROR_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFsError(error) {
    return TRANSIENT_FS_ERROR_CODES.has(error?.code);
}

function formatError(error) {
    const code = error?.code ? `${error.code}: ` : '';
    return `${code}${error?.message || String(error)}`;
}

function processExists(pid) {
    if (!pid || Number.isNaN(pid)) return false;
    if (process.platform === 'win32') {
        const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10_000,
        });
        return result.status === 0 && result.stdout.includes(String(pid));
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function killProcessTree(pid, { label = 'process', prefix = '[tauri-e2e]', tree = true } = {}) {
    if (!pid || Number.isNaN(pid)) {
        return { ok: false, skipped: true, message: 'invalid pid' };
    }

    if (process.platform === 'win32') {
        const args = ['/PID', String(pid)];
        if (tree) args.push('/T');
        args.push('/F');
        const result = spawnSync('taskkill', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 30_000,
        });
        if (result.status === 0) {
            console.log(`${prefix} ${label} PID=${pid} stopped.`);
            return { ok: true, skipped: false };
        }
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        if (!processExists(pid)) {
            console.log(`${prefix} ${label} PID=${pid} already stopped.`);
            return { ok: true, skipped: false, alreadyStopped: true };
        }
        console.warn(`${prefix} failed to stop ${label} PID=${pid}: ${output || `exit ${result.status}`}`);
        return { ok: false, skipped: false, message: output || `exit ${result.status}` };
    }

    try {
        process.kill(tree ? -pid : pid, 'SIGTERM');
        console.log(`${prefix} ${label} PID=${pid} SIGTERM sent.`);
        return { ok: true, skipped: false };
    } catch (error) {
        if (!processExists(pid)) {
            console.log(`${prefix} ${label} PID=${pid} already stopped.`);
            return { ok: true, skipped: false, alreadyStopped: true };
        }
        console.warn(`${prefix} failed to stop ${label} PID=${pid}: ${formatError(error)}`);
        return { ok: false, skipped: false, message: formatError(error) };
    }
}

async function removePathWithRetry(targetPath, {
    attempts = 8,
    delayMs = 200,
    label = targetPath,
    prefix = '[tauri-e2e]',
    recursive = false,
} = {}) {
    if (!targetPath) return false;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (!fs.existsSync(targetPath)) return false;

        try {
            fs.rmSync(targetPath, { recursive, force: true });
            return true;
        } catch (error) {
            const canRetry = isTransientFsError(error) && attempt < attempts;
            if (canRetry) {
                const waitMs = Math.min(delayMs * attempt, 2_000);
                console.warn(
                    `${prefix} ${label} cleanup retry ${attempt}/${attempts} after ${formatError(error)}`,
                );
                await delay(waitMs);
                continue;
            }

            console.warn(
                `${prefix} ${label} cleanup skipped as non-blocking after ${attempt}/${attempts}: ` +
                `${formatError(error)}`,
            );
            return false;
        }
    }

    return false;
}

async function removeSidecarsWithRetry(basePath, suffixes, options = {}) {
    let removed = 0;
    for (const suffix of suffixes) {
        const file = `${basePath}${suffix}`;
        if (await removePathWithRetry(file, { ...options, label: `${options.label || basePath}${suffix}` })) {
            removed += 1;
        }
    }
    return removed;
}

module.exports = {
    delay,
    killProcessTree,
    removePathWithRetry,
    removeSidecarsWithRetry,
};


import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const TEST_DIR = path.join(__dirname, 'temp-restore-test');
const DB_PATH = path.join(TEST_DIR, 'dev.db');
const PENDING_PATH = path.join(TEST_DIR, 'pending_restore.db');
const RESTORE_LOG = path.join(TEST_DIR, 'restore.log');

// Duplicated logic from main.ts for verification
function checkPendingRestore(userDataPath: string) {
    try {
        const pendingPath = path.join(userDataPath, 'pending_restore.db');
        const dbPath = path.join(userDataPath, 'dev.db');
        const restoreLogPath = path.join(userDataPath, 'restore.log');

        const logRestore = (msg: string) => {
            try {
                fs.appendFileSync(restoreLogPath, `[${new Date().toISOString()}] ${msg}\n`);
            } catch (_e) { }  
        };

        if (fs.existsSync(pendingPath)) {
            logRestore('Found pending restore file.');

            // Try to delete current DB
            if (fs.existsSync(dbPath)) {
                try {
                    fs.unlinkSync(dbPath);
                    logRestore('Deleted old DB.');
                } catch (e: any) {  
                    logRestore(`Failed to delete old DB: ${e.message}`);
                    // Continue anyway, copyFileSync might overwrite
                }
            }

            // Delete WAL and SHM files
            const walPath = dbPath + '-wal';
            const shmPath = dbPath + '-shm';
            if (fs.existsSync(walPath)) {
                try { fs.unlinkSync(walPath); logRestore('Deleted WAL file.'); } catch (_e) { }  
            }
            if (fs.existsSync(shmPath)) {
                try { fs.unlinkSync(shmPath); logRestore('Deleted SHM file.'); } catch (_e) { }  
            }

            try {
                fs.copyFileSync(pendingPath, dbPath);
                logRestore('Copied pending file to DB.');
                fs.unlinkSync(pendingPath);
                logRestore('Deleted pending file. Success.');
                return true;
            } catch (e: any) {  
                logRestore(`CRITICAL ERROR copying: ${e.message}`);
                throw e;
            }
        }
        return false;
    } catch (e: any) {  
        console.error(e);
        return false;
    }
}

describe('Backup Restore Logic (File System)', () => {
    beforeEach(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR);
        // Create dummy DB
        fs.writeFileSync(DB_PATH, 'ORIGINAL_DATA');
        // Create dummy WAL (simulating open DB leftover)
        fs.writeFileSync(DB_PATH + '-wal', 'WAL_DATA');
    });

    afterEach(() => {
        // Cleanup
        try {
            if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
            if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
            if (fs.existsSync(PENDING_PATH)) fs.unlinkSync(PENDING_PATH);
            if (fs.existsSync(RESTORE_LOG)) fs.unlinkSync(RESTORE_LOG);
            fs.rmdirSync(TEST_DIR);
        } catch (_e) { }  
    });

    it('should successfully swap database files when pending exists', () => {
        // Create pending file
        fs.writeFileSync(PENDING_PATH, 'NEW_RESTORED_DATA');

        // Run logic
        const result = checkPendingRestore(TEST_DIR);

        // Verify result
        expect(result).toBe(true);
        // Pending should be gone
        expect(fs.existsSync(PENDING_PATH)).toBe(false);
        // DB should be new content
        const newContent = fs.readFileSync(DB_PATH, 'utf-8');
        expect(newContent).toBe('NEW_RESTORED_DATA');
        // WAL should be gone
        expect(fs.existsSync(DB_PATH + '-wal')).toBe(false);
    });

    it('should do nothing if pending file does not exist', () => {
        const result = checkPendingRestore(TEST_DIR);
        expect(result).toBe(false);
        const content = fs.readFileSync(DB_PATH, 'utf-8');
        expect(content).toBe('ORIGINAL_DATA');
    });
});

/**
 * E2E Test Utilities
 * Common helpers for Playwright E2E tests
 */

import type { Page } from '@playwright/test';

// ==================== License Helpers ====================

/**
 * Client-side obfuscation key (must match encryption.ts)
 */
const CLIENT_OBFUSCATION_KEY = 'RheoLab2025ClientCache';

/**
 * Obfuscate data for localStorage (matches client-side encryption)
 */
function obfuscate(text: string): string {
    const keyBytes = new TextEncoder().encode(CLIENT_OBFUSCATION_KEY);
    const textBytes = new TextEncoder().encode(text);
    const result = new Uint8Array(textBytes.length);

    for (let i = 0; i < textBytes.length; i++) {
        result[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
    }

    let binary = '';
    for (let i = 0; i < result.length; i++) {
        binary += String.fromCharCode(result[i]);
    }
    return 'OBF:' + Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Create a test license object
 */
function createTestLicense() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

    return {
        id: 'e2e-test-license',
        type: 'developer',
        customerName: 'E2E Test User',
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        gracePeriodDays: 30,
        machineId: 'e2e-test-machine',
        features: {
            maxExperiments: -1,
            maxComparisonExperiments: 8,
            exportPdf: true,
            exportExcel: true,
            aiParsing: true,
            comparison: true,
            watermark: false,
            calibrationAnalysis: true,
            calibrationParsing: true,
            chandler5550Support: true,
            bslR1Support: true,
        }
    };
}

/**
 * Set up a test license in localStorage
 * Call this BEFORE navigating to the app to prevent license modal
 */
export async function setupTestLicense(page: Page): Promise<void> {
    const license = createTestLicense();
    const licenseJson = JSON.stringify(license);
    const encryptedLicense = obfuscate(licenseJson);
    const encryptedKey = obfuscate('E2E0-TEST-LICE-NSE0');

    await page.addInitScript((data) => {
        localStorage.setItem('rheolab_license', data.encryptedLicense);
        localStorage.setItem('rheolab_license_key', data.encryptedKey);
        // Also set raw data for signature validation bypass in tests
        localStorage.setItem('rheolab_license_raw', data.encryptedLicense);
        localStorage.setItem('rheolab_license_signature', 'e2e-test-signature');
        
        // Prevent StartupCheck dialogs from blocking the UI
        sessionStorage.setItem('rheolab_api_key_warning_shown', 'true');
    }, { encryptedLicense, encryptedKey });

    console.log('[E2E] Test license configured');
}

/**
 * Clear test license from localStorage
 */
export async function clearTestLicense(page: Page): Promise<void> {
    await page.evaluate(() => {
        localStorage.removeItem('rheolab_license');
        localStorage.removeItem('rheolab_license_key');
        localStorage.removeItem('rheolab_license_raw');
        localStorage.removeItem('rheolab_license_signature');
    });
    console.log('[E2E] Test license cleared');
}

/**
 * Login to the app as admin with retry logic for rate limiting
 */
export async function loginAsAdmin(page: Page, maxRetries = 3): Promise<void> {
    // Wait for page to stabilize
    await page.waitForLoadState('domcontentloaded');
    
    // Check if we're on the login page
    const currentUrl = page.url();
    console.log('Current URL before login check:', currentUrl);
    
    // If not on login page, we're already authenticated
    if (!currentUrl.includes('/login')) {
        console.log('Already on dashboard, skipping login');
        return;
    }
    
    // Retry loop for rate limiting (429 errors)
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`Login attempt ${attempt}/${maxRetries}`);
        
        // Wait longer on each retry to let rate limit reset
        const waitTime = attempt === 1 ? 2000 : attempt * 5000;
        await page.waitForTimeout(waitTime);
        
        // Reload page if we got rate limited
        if (attempt > 1) {
            console.log('Reloading page after rate limit...');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);
        }
        
        // Try to find the login button with a proper wait
        const loginButton = page.getByRole('button', { name: /Sign in|Log in|Войти/i });
        
        try {
            await loginButton.waitFor({ state: 'visible', timeout: 20000 });
            console.log('Login form visible. Logging in...');
            
            // Fill credentials
            const emailInput = page.getByPlaceholder(/Email|логин/i);
            await emailInput.waitFor({ state: 'visible', timeout: 10000 });
            await emailInput.fill('admin');
            
            const passwordInput = page.getByPlaceholder(/пароль|password|••••/i);
            await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
            await passwordInput.fill('admin');
            
            await loginButton.click();
            
            // Wait for redirect to dashboard
            await page.waitForURL('**/dashboard', { timeout: 45000, waitUntil: 'domcontentloaded' });
            console.log('Logged in successfully');
            return; // Success!
        } catch (e) {
            // Check if we ended up on dashboard anyway
            if (page.url().includes('/dashboard')) {
                console.log('Already redirected to dashboard');
                return;
            }
            
            const errorMsg = (e as Error).message;
            console.log(`Login attempt ${attempt} failed: ${errorMsg}`);
            
            // If rate limited, continue to next retry
            if (errorMsg.includes('429') || errorMsg.includes('Timeout')) {
                if (attempt < maxRetries) {
                    console.log(`Rate limited, waiting before retry...`);
                    continue;
                }
            }
        }
    }
    
    // Final check - maybe we're on dashboard despite errors
    if (page.url().includes('/dashboard')) {
        console.log('Ended up on dashboard after retries');
        return;
    }
    
    console.log('All login attempts failed');
}

/**
 * Wait for WASM engine to be loaded
 * Listens for the "[WasmEngine] Loaded successfully" console message
 */
export async function waitForWasm(page: Page, timeoutMs = 30000): Promise<boolean> {
    console.log('Waiting for WASM module to load...');

    return new Promise<boolean>((resolve) => {
        let resolved = false;

        const handler = (msg: { text(): string }) => {
            const text = msg.text();
            if (text.includes('[WasmEngine] Loaded successfully')) {
                if (!resolved) {
                    resolved = true;
                    console.log('WASM loaded successfully');
                    page.off('console', handler);
                    resolve(true);
                }
            }
        };

        page.on('console', handler);

        // Timeout fallback
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.log('WASM load timeout - may already be loaded or will load later');
                page.off('console', handler);
                resolve(false);
            }
        }, timeoutMs);
    });
}

/**
 * Full dashboard setup: navigate, login if needed, wait for WASM
 */
export async function setupDashboard(page: Page): Promise<void> {
    // Set up console log listener BEFORE navigation
    page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
    page.on('pageerror', err => console.error(`BROWSER ERROR: ${err.message}`));

    console.log('Navigating to /');
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await page.goto('/');
            lastError = null;
            break;
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('ERR_ABORTED') || attempt === 3) {
                throw error;
            }
            console.log(`Navigation attempt ${attempt}/3 failed (${message}), retrying...`);
            await page.waitForTimeout(1000 * attempt);
        }
    }
    if (lastError) {
        throw lastError;
    }
    await page.waitForLoadState('domcontentloaded');

    await loginAsAdmin(page);

    // Wait a bit for WASM to initialize after page fully loads
    await page.waitForTimeout(3000);

    // Optionally try to wait for WASM log, but don't fail if timeout
    await waitForWasm(page, 15000);
}

/**
 * Wait for analysis to complete by checking for key UI elements
 */
export async function waitForAnalysisComplete(page: Page, timeoutMs = 60000): Promise<void> {
    console.log('Waiting for analysis to complete...');

    // Wait for either the analysis section or the chart to appear
    const analysisSection = page.getByText('Реологический анализ');
    const chartWrapper = page.locator('.uplot-container').first();

    await Promise.race([
        analysisSection.waitFor({ state: 'visible', timeout: timeoutMs }),
        chartWrapper.waitFor({ state: 'visible', timeout: timeoutMs })
    ]);

    console.log('Analysis appears complete');
}

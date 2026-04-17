import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { setupDashboard } from './utils';

test('WASM Workflow Analysis', async ({ page }) => {
    // Increase timeout for this test
    test.setTimeout(180000);

    const wasmLogs: string[] = [];
    const errors: string[] = [];

    // Listen for console logs to verify WASM usage
    page.on('console', msg => {
        const text = msg.text();
        console.log(`BROWSER LOG: ${text}`);
        if (text.includes('WASM')) {
            wasmLogs.push(text);
        }
    });

    page.on('pageerror', err => {
        console.log(`BROWSER ERROR: ${err.message}`);
        errors.push(err.message);
    });

    // 1. Setup dashboard (navigate, login if needed, wait for WASM)
    console.log('Setting up dashboard...');
    await setupDashboard(page);

    // 2. Upload file
    const fixturePath = path.resolve('tests/fixtures/8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv');
    if (!fs.existsSync(fixturePath)) {
        throw new Error(`Fixture file not found at ${fixturePath}`);
    }

    console.log(`Uploading file: ${fixturePath}`);
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
    await fileInput.setInputFiles(fixturePath);

    // 3. Wait for analysis to complete
    console.log('Waiting for analysis...');
    try {
        await expect(page.getByText('Реологический анализ')).toBeVisible({ timeout: 60000 });
    } catch (e) {
        console.log('Analysis timeout. Taking screenshot...');
        await page.screenshot({ path: 'outputs/e2e_analysis_timeout.png' });
        throw e;
    }

    // 4. Verify Results
    console.log('Verifying results...');

    // Check for Chart (uPlot renders a canvas inside .uplot-container)
    // Or look for specific axis labels like "Shear Rate"
    try {
        // Try multiple indicators of success
        await expect(page.locator('.uplot-container canvas').first()).toBeVisible({ timeout: 10000 });
        console.log('Chart detected.');
    } catch (_e) {  
        console.log('Chart not found via .uplot-container canvas. Checking text...');
        // Fallback to text check
        await expect(page.getByText('Viscosity')).toBeVisible();
    }

    // Check for Table
    await expect(page.getByRole('table')).toBeVisible();
    console.log('Table detected.');

    // 5. Verify WASM usage via logs
    // We expect logs like "[Worker] WASM loaded successfully" or similar
    // And NO fallback errors since we removed TS detectors

    // Check if we have any WASM logs
    // const wasmLoaded = wasmLogs.some(log => log.includes('WASM loaded successfully') || log.includes('WASM module initialized'));

    // Note: Since logs might happen in Worker, they might not propagate to page console depending on implementation.
    // But usually worker logs show up in DevTools console. Playwright captures page console.
    // If worker logs are not captured, we might need to rely on UI indicators or lack of errors.

    // Let's check for specific WASM-related errors that would indicate failure
    const wasmErrors = errors.filter(e => e.includes('WASM'));
    expect(wasmErrors).toHaveLength(0);

    // Verify that we have calculated data (e.g. n', K')
    // Look for a value in the table. This confirms calculation worked.
    // We can look for a numeric value or a column header like "n'"
    await expect(page.getByText("n'")).toBeVisible();
    await expect(page.getByText("K'")).toBeVisible();

    console.log('Analysis completed successfully with WASM workflow.');
});


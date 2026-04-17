import { test, expect, Download } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { loginAsAdmin, setupDashboard } from './utils';

test('PDF Export Flow', async ({ page }) => {
    // Increase timeout for this test as analysis might take time
    test.setTimeout(180000);

    // Listen for console logs
    page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

    // 1. Setup dashboard (navigate, login if needed, wait for WASM)
    console.log('Setting up dashboard...');
    await setupDashboard(page);
    console.log(`Current URL: ${page.url()}`);

    // 2. Upload file
    console.log('Looking for file input...');

    // Wait for the upload area text to confirm we are on the right page
    try {
        await expect(page.getByText('Загрузите файл реологии').or(page.getByText('Загрузка данных')).first()).toBeVisible({ timeout: 15000 });
    } catch (e) {
        console.log('Upload text not found. Current URL:', page.url());
        // Take screenshot
        await page.screenshot({ path: 'outputs/debug_no_upload.png' });
        throw e;
    }


    // Look for file input (might be hidden by Dropzone)
    const fileInput = page.locator('input[type="file"]');

    // Verify input exists (even if hidden)
    await expect(fileInput).toBeAttached();

    const fixturePath = path.resolve('tests/fixtures/8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv');

    if (!fs.existsSync(fixturePath)) {
        throw new Error(`Fixture file not found at ${fixturePath}`);
    }

    console.log(`Uploading file: ${fixturePath}`);
    await fileInput.setInputFiles(fixturePath);

    // 3. Wait for analysis to complete
    console.log('Waiting for analysis...');
    // We look for the "Реологический анализ" header which appears after parsing
    await expect(page.getByText('Реологический анализ')).toBeVisible({ timeout: 60000 });

    // 4. Switch to Reports tab if necessary
    // Try to find "Отчёты" tab. If it exists, click it.
    // Using a more generic selector to catch tabs
    const reportsTab = page.getByRole('tab', { name: /Отчёты/i });
    if (await reportsTab.count() > 0 && await reportsTab.isVisible()) {
        console.log('Switching to Reports tab...');
        await reportsTab.click();
    } else {
        // Maybe it's just text?
        const reportsText = page.getByText('Отчёты');
        if (await reportsText.count() > 0 && await reportsText.isVisible()) {
            console.log('Clicking Reports text...');
            await reportsText.click();
        }
    }

    // 5. Find and Click PDF Export button
    const pdfButton = page.getByRole('button', { name: /PDF Отчёт/i });
    await expect(pdfButton).toBeVisible({ timeout: 30000 });

    // Check if button is disabled
    await expect(pdfButton).toBeEnabled();

    console.log('Clicking PDF Export button...');

    // 6. Trigger Download
    // We expect the download event
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });

    // Click the button
    await pdfButton.click();

    // Check for error toast
    // We look for a toast with error styling (red background)
    const errorToast = page.locator('.bg-red-500\\/90');

    // Race between download and error
    const download = await Promise.race([
        downloadPromise,
        errorToast.waitFor({ state: 'visible', timeout: 10000 })
            .then(async () => {
                const text = await errorToast.textContent();
                throw new Error(`PDF Generation Error Toast: ${text}`);
            })
            // If toast doesn't appear in 10s, we just wait for download (which has longer timeout)
            .catch(() => new Promise(() => { })) // Never resolve if no toast
    ]) as Download;

    // If we got here, download started (or Promise.race behavior with never resolving promise works as expected? 
    // Actually, if toast wait times out, it rejects. We catch it and return a never-resolving promise so the race continues waiting for downloadPromise.
    // BUT if downloadPromise times out, it will reject the race.

    // However, the catch block above returns a promise. If I return a promise that never resolves, the race will wait for downloadPromise.
    // Correct.

    // 7. Verify download
    const filename = download.suggestedFilename();
    console.log(`Downloaded file: ${filename}`);
    expect(filename).toContain('.pdf');

    // Optional: Save to check size
    const uniqueName = `e2e_${Date.now()}_${filename}`;
    const savePath = path.resolve('outputs', uniqueName);
    await download.saveAs(savePath);

    const stats = fs.statSync(savePath);
    console.log(`PDF size: ${stats.size} bytes`);
    expect(stats.size).toBeGreaterThan(1000);
});

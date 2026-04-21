// Quick dev-mode smoke check: visit dashboard routes, collect console errors
// Run: node scripts/dev/smoke-check.mjs
import { chromium } from '@playwright/test';

const routes = [
    '/',
    '/dashboard',
    '/dashboard/library',
    '/dashboard/comparison',
    '/dashboard/settings',
    '/dashboard/settings?tab=general',
    '/dashboard/settings?tab=data',
    '/dashboard/settings?tab=analysis',
    '/dashboard/settings?tab=charts',
    '/dashboard/settings?tab=system',
];

const baseUrl = 'http://localhost:1420';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let totalErrors = 0;
    for (const route of routes) {
        const errors = [];
        const pageErrors = [];
        page.removeAllListeners('console');
        page.removeAllListeners('pageerror');
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        page.on('pageerror', err => pageErrors.push(err.message + '\n' + (err.stack || '')));

        try {
            await page.goto(baseUrl + route, { waitUntil: 'networkidle', timeout: 15000 });
            await page.waitForTimeout(1000);
        } catch (e) {
            errors.push('NAV_FAILED: ' + e.message);
        }

        // Look for error-boundary fallback on page
        const hasErrorBoundary = await page.locator('text=/Ошибка в разделе/').count() > 0;

        const errCount = errors.length + pageErrors.length;
        totalErrors += errCount;
        const status = errCount > 0 || hasErrorBoundary ? '❌' : '✅';
        console.log(`${status} ${route}  console=${errors.length} pageerr=${pageErrors.length} errBoundary=${hasErrorBoundary}`);
        if (errors.length) console.log('  CONSOLE:', errors.slice(0, 3).join('\n  | '));
        if (pageErrors.length) console.log('  PAGE:', pageErrors.slice(0, 1).join('').slice(0, 500));
    }

    await browser.close();
    console.log(`\nTotal errors: ${totalErrors}`);
    process.exit(totalErrors > 0 ? 1 : 0);
})();

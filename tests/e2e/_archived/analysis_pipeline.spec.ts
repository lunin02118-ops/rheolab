import { test, expect, Page } from '@playwright/test';
import { setupDashboard } from './utils';

const ANALYSIS_FIXTURES = [
    {
        fileName: '8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv',
        displayName: 'Chandler SST @ 63°C',
    },
    {
        fileName: '8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv',
        displayName: 'Chandler SWB @ 96°C',
    },
];

async function loadDemoFixture(page: Page, fixture: { fileName: string; displayName: string }) {
    const demoButton = page.getByTestId('DemoFilesButton').first();
    await expect(demoButton).toBeVisible({ timeout: 15000 });
    await demoButton.click();

    const dropdown = page.getByTestId('DemoFilesDropdown').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    const byTestId = page.getByTestId(`DemoFileItem-${fixture.fileName}`).first();
    if (await byTestId.count()) {
        await expect(byTestId).toBeVisible({ timeout: 5000 });
        await byTestId.click();
        return;
    }

    const byText = dropdown.getByRole('button', { name: new RegExp(fixture.displayName, 'i') }).first();
    await expect(byText).toBeVisible({ timeout: 5000 });
    await byText.click();
}

test.describe('Analysis pipeline regression', () => {
    test.setTimeout(180000);

    for (const fixture of ANALYSIS_FIXTURES) {
        test(`analyzes demo fixture without generic analysis failure (${fixture.fileName})`, async ({ page }) => {
            await setupDashboard(page);
            await loadDemoFixture(page, fixture);

            const outcome = await page.waitForFunction(() => {
                const bodyText = document.body.innerText || '';
                if (bodyText.includes('Ошибка анализа данных')) {
                    return { status: 'error' };
                }

                const cycleMatch = bodyText.match(/\((\d+)\s+циклов\)/);
                if (cycleMatch) {
                    const cycleCount = Number(cycleMatch[1]);
                    if (Number.isFinite(cycleCount) && cycleCount > 0) {
                        return { status: 'ok', cycleCount };
                    }
                }

                return false;
            }, { timeout: 90000 });

            const result = await outcome.jsonValue() as { status: 'ok' | 'error'; cycleCount?: number };
            expect(result.status).toBe('ok');
            expect(result.cycleCount ?? 0).toBeGreaterThan(0);

            await expect(page.getByText('Ошибка анализа данных')).toHaveCount(0);
        });
    }
});

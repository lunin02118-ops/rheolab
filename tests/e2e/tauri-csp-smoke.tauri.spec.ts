import { test, expect, setupBeforeEach } from './base-test.tauri';

setupBeforeEach(test);

const CSP_VIOLATION_PATTERN = /content security policy|violates? the following .*directive|refused to (load|execute|apply|connect).*policy/i;

test.describe('[Security/Tauri] CSP smoke', () => {
  test('desktop shell loads without CSP console violations', async ({ page }) => {
    const cspMessages: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (CSP_VIOLATION_PATTERN.test(text)) {
        cspMessages.push(`[console:${msg.type()}] ${text}`);
      }
    });
    page.on('pageerror', (error) => {
      const text = error.message;
      if (CSP_VIOLATION_PATTERN.test(text)) {
        cspMessages.push(`[pageerror] ${text}`);
      }
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body?.children.length > 0, undefined, {
      timeout: 30_000,
    });
    await page.waitForTimeout(2_000);

    expect(cspMessages).toEqual([]);
  });
});

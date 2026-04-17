import { test, expect, Download } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { loginAsAdmin } from './utils';

/**
 * Report Generation Combinations Test
 * 
 * Tests all possible combinations of report settings using Grace demo file:
 * 
 * Chart Settings:
 * - showTemperature: true/false
 * - showShearRate: true/false  
 * - showPressure: true/false
 * - shearRateAxis: left/right
 * - pressureAxis: left/right
 * 
 * Output Settings:
 * - language: ru/en
 * - unitSystem: SI/Imperial
 * 
 * Additional Settings:
 * - showTouchPoints: true/false
 * - showCalibration: true/false
 * - viscosityThreshold: number
 * - showTargetTime: true/false
 * - targetTime: number
 */

// Test configuration
const TEST_OUTPUT_DIR = 'outputs/report-combinations';

// Report settings combinations to test
interface ReportSettings {
    name: string;
    language: 'ru' | 'en';
    unitSystem: 'SI' | 'Imperial';
    showTemperature: boolean;
    showShearRate: boolean;
    showPressure: boolean;
    shearRateAxis?: 'left' | 'right';
    pressureAxis?: 'left' | 'right';
}

// Define all combinations to test
const SETTINGS_COMBINATIONS: ReportSettings[] = [
    // Basic combinations - Language & Units
    { name: 'RU_SI_default', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: false },
    { name: 'EN_SI_default', language: 'en', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: false },
    { name: 'RU_Imperial_default', language: 'ru', unitSystem: 'Imperial', showTemperature: true, showShearRate: true, showPressure: false },
    { name: 'EN_Imperial_default', language: 'en', unitSystem: 'Imperial', showTemperature: true, showShearRate: true, showPressure: false },
    
    // Temperature variations
    { name: 'RU_SI_noTemp', language: 'ru', unitSystem: 'SI', showTemperature: false, showShearRate: true, showPressure: false },
    { name: 'EN_SI_noTemp', language: 'en', unitSystem: 'SI', showTemperature: false, showShearRate: true, showPressure: false },
    
    // Shear Rate variations
    { name: 'RU_SI_noShear', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: false, showPressure: false },
    { name: 'RU_SI_shearRight', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: false, shearRateAxis: 'right' },
    { name: 'RU_SI_shearLeft', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: false, shearRateAxis: 'left' },
    
    // Pressure variations
    { name: 'RU_SI_withPressure', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: true },
    { name: 'RU_SI_pressureRight', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: true, pressureAxis: 'right' },
    { name: 'RU_SI_pressureLeft', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: true, pressureAxis: 'left' },
    
    // Minimal chart (only viscosity)
    { name: 'RU_SI_minimal', language: 'ru', unitSystem: 'SI', showTemperature: false, showShearRate: false, showPressure: false },
    { name: 'EN_Imperial_minimal', language: 'en', unitSystem: 'Imperial', showTemperature: false, showShearRate: false, showPressure: false },
    
    // Full chart (all lines)
    { name: 'RU_SI_full', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: true },
    { name: 'EN_Imperial_full', language: 'en', unitSystem: 'Imperial', showTemperature: true, showShearRate: true, showPressure: true },
    
    // Axis position combinations
    { name: 'RU_SI_allRight', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: true, shearRateAxis: 'right', pressureAxis: 'right' },
    { name: 'RU_SI_mixed', language: 'ru', unitSystem: 'SI', showTemperature: true, showShearRate: true, showPressure: true, shearRateAxis: 'left', pressureAxis: 'right' },
];

test.describe('Report Generation - All Combinations', () => {
    test.setTimeout(600000); // 10 minutes for all combinations

    test.beforeAll(async () => {
        // Ensure output directory exists
        const outputDir = path.resolve(TEST_OUTPUT_DIR);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    });

    test('Generate PDF and Excel reports with all setting combinations', async ({ page }) => {
        const testResults: Record<string, { pdf: boolean; excel: boolean; pdfSize: number; excelSize: number }> = {};
        
        // ═══════════════════════════════════════════════════════════════════
        // HELPERS
        // ═══════════════════════════════════════════════════════════════════
        
        const waitForPageReady = async () => {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForFunction(() => {
                return document.readyState === 'complete' && !document.querySelector('[data-loading="true"]');
            }, { timeout: 10000 }).catch(() => {});
        };

        const ensureNoModal = async () => {
            const dialog = page.getByRole('dialog');
            if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
                await page.keyboard.press('Escape');
                await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
            }
        };

        // Load demo file - prefer SWB (has pressure data) for pressure tests
        const loadDemoFile = async (preferPressureData: boolean = false) => {
            // Click on "Demo Файлы" button
            const demoBtn = page.locator('button').filter({ hasText: /Demo Файлы/i }).first();
            await expect(demoBtn).toBeVisible({ timeout: 10000 });
            await demoBtn.click();
            await page.waitForTimeout(800);
            
            // Wait for dropdown to be visible
            const dropdown = page.locator('.max-h-64');
            await expect(dropdown).toBeVisible({ timeout: 3000 });
            
            // For pressure tests, prefer SWB file (Simulated Wellbore with pressure data)
            if (preferPressureData) {
                const swbOption = dropdown.locator('button:has-text("SWB")').first();
                if (await swbOption.isVisible({ timeout: 1000 }).catch(() => false)) {
                    console.log('Clicking SWB option (has pressure data)...');
                    await swbOption.click();
                    return;
                }
            }
            
            // Select Chandler SST (has calibration data)
            const sstOption = dropdown.locator('button:has-text("SST")').first();
            if (await sstOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                console.log('Clicking SST option (Chandler with calibration)...');
                await sstOption.click();
            } else {
                // Fallback to Chandler 5550
                const chandlerOption = dropdown.locator('button:has-text("Chandler 5550")').first();
                if (await chandlerOption.isVisible({ timeout: 1000 }).catch(() => false)) {
                    console.log('Clicking Chandler 5550 option...');
                    await chandlerOption.click();
                } else {
                    // Fallback to Grace
                    const graceOption = dropdown.locator('button:has-text("Grace")').first();
                    if (await graceOption.isVisible({ timeout: 1000 }).catch(() => false)) {
                        console.log('Clicking Grace option...');
                        await graceOption.click();
                    } else {
                        // Last fallback - click first button in dropdown
                        const anyOption = dropdown.locator('button').first();
                        if (await anyOption.isVisible({ timeout: 1000 }).catch(() => false)) {
                            const text = await anyOption.textContent();
                            console.log(`Clicking first available option: ${text}...`);
                            await anyOption.click();
                        } else {
                            throw new Error('No demo file options found in dropdown!');
                        }
                    }
                }
            }
            
            // CRITICAL: Wait for data to be loaded and stored
            // This ensures the API call completes and data is saved to sessionStorage
            console.log('Waiting for data to load after Demo selection...');
            
            // Wait for "Реологический анализ" section to appear (indicates data loaded)
            await expect(page.getByText('Реологический анализ')).toBeVisible({ timeout: 30000 });
            console.log('✓ "Реологический анализ" section visible');
            
            // Wait for uPlot chart to appear (confirms data is rendered)
            await expect(page.locator('.uplot-container').first()).toBeVisible({ timeout: 30000 });
            console.log('✓ Chart rendered');
            
            // Give store a moment to persist to sessionStorage
            await page.waitForTimeout(1000);
            
            // Debug: Check if sessionStorage has data
            const storeData = await page.evaluate(() => {
                const data = sessionStorage.getItem('rheolab-experiment-data');
                if (data) {
                    try {
                        const parsed = JSON.parse(data);
                        return {
                            hasParseResult: !!parsed?.state?.parseResult,
                            dataLength: parsed?.state?.parseResult?.data?.length || 0,
                            filename: parsed?.state?.parseResult?.metadata?.filename || 'N/A'
                        };
                    } catch {
                        return { error: 'Parse failed' };
                    }
                }
                return { error: 'No data in sessionStorage' };
            });
            console.log('SessionStorage state:', JSON.stringify(storeData));
            
            if (!storeData.hasParseResult) {
                throw new Error('Demo file not saved to sessionStorage - store persistence issue!');
            }
        };

        // Apply settings on Reports page - full implementation
        const applySettings = async (settings: ReportSettings) => {
            console.log(`\n📋 Applying settings: ${settings.name}`);
            
            try {
                // Language toggle (RU/EN) - click the correct language button
                const langText = settings.language === 'en' ? 'English' : 'Русский';
                const langBtn = page.locator(`button:has-text("${langText}")`).first();
                if (await langBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await langBtn.click();
                    await page.waitForTimeout(200);
                    console.log(`  ✓ Language: ${settings.language.toUpperCase()}`);
                }
                
                // Unit System toggle (SI/Imperial)
                const unitText = settings.unitSystem === 'Imperial' ? 'Imperial' : 'SI';
                const unitBtn = page.locator(`button:has-text("${unitText}")`).first();
                if (await unitBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await unitBtn.click();
                    await page.waitForTimeout(200);
                    console.log(`  ✓ Units: ${settings.unitSystem}`);
                }
                
                // Chart toggles - Temperature
                const tempToggle = page.locator('button:has-text("Температура")').first();
                if (await tempToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
                    const isTempEnabled = await tempToggle.evaluate(el => el.className.includes('orange'));
                    if (settings.showTemperature !== isTempEnabled) {
                        await tempToggle.click();
                        await page.waitForTimeout(200);
                        console.log(`  ✓ Temperature: ${settings.showTemperature ? 'ON' : 'OFF'}`);
                    }
                }
                
                // Chart toggles - Shear Rate
                const shearToggle = page.locator('button:has-text("Скор. сдвига")').first();
                if (await shearToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
                    const isShearEnabled = await shearToggle.evaluate(el => el.className.includes('purple'));
                    if (settings.showShearRate !== isShearEnabled) {
                        await shearToggle.click();
                        await page.waitForTimeout(300);
                        console.log(`  ✓ Shear Rate: ${settings.showShearRate ? 'ON' : 'OFF'}`);
                    }
                    
                    // Shear Rate Axis (L/R) - only if shear rate is enabled
                    // Find L/R buttons in the same row as Shear Rate toggle
                    if (settings.showShearRate && settings.shearRateAxis) {
                        const shearRow = shearToggle.locator('..'); // parent div.flex
                        const axisContainer = shearRow.locator('div.flex.bg-slate-950'); // L/R button container
                        const btnText = settings.shearRateAxis === 'left' ? 'L' : 'R';
                        const axisBtn = axisContainer.locator(`button:has-text("${btnText}")`);
                        if (await axisBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                            await axisBtn.click();
                            await page.waitForTimeout(200);
                            console.log(`  ✓ Shear Axis: ${settings.shearRateAxis}`);
                        }
                    }
                }
                
                // Chart toggles - Pressure
                const pressureToggle = page.locator('button:has-text("Давление")').first();
                if (await pressureToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
                    const isPressureEnabled = await pressureToggle.evaluate(el => el.className.includes('green'));
                    if (settings.showPressure !== isPressureEnabled) {
                        await pressureToggle.click();
                        await page.waitForTimeout(300);
                        console.log(`  ✓ Pressure: ${settings.showPressure ? 'ON' : 'OFF'}`);
                    }
                    
                    // Pressure Axis (L/R) - only if pressure is enabled
                    // Find L/R buttons in the same row as Pressure toggle
                    if (settings.showPressure && settings.pressureAxis) {
                        const pressureRow = pressureToggle.locator('..'); // parent div.flex
                        const axisContainer = pressureRow.locator('div.flex.bg-slate-950'); // L/R button container
                        const btnText = settings.pressureAxis === 'left' ? 'L' : 'R';
                        const axisBtn = axisContainer.locator(`button:has-text("${btnText}")`);
                        if (await axisBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                            await axisBtn.click();
                            await page.waitForTimeout(200);
                            console.log(`  ✓ Pressure Axis: ${settings.pressureAxis}`);
                        }
                    }
                }
                
                console.log('  ✓ Settings applied');
                // Wait for chart to re-render after settings change
                await page.waitForTimeout(1500);
            } catch (error) {
                console.log(`  ⚠ Settings error: ${error}`);
            }
        };

        // Generate PDF report
        const generatePDF = async (settingName: string): Promise<{ success: boolean; size: number }> => {
            const pdfBtn = page.locator('button:has-text("PDF Отчёт"), button:has-text("PDF Report")').first();
            
            if (!await pdfBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                console.log('  ⚠ PDF button not visible');
                return { success: false, size: 0 };
            }
            
            await expect(pdfBtn).toBeEnabled({ timeout: 5000 });
            
            try {
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 90000 }),
                    pdfBtn.click()
                ]) as [Download, unknown];
                
                const timestamp = Date.now();
                const filename = `${settingName}_${timestamp}.pdf`;
                const savePath = path.resolve(TEST_OUTPUT_DIR, filename);
                await download.saveAs(savePath);
                
                const stats = fs.statSync(savePath);
                console.log(`  ✓ PDF: ${filename} (${stats.size} bytes)`);
                
                // Validate PDF
                const buffer = fs.readFileSync(savePath);
                const header = buffer.slice(0, 5).toString();
                if (header !== '%PDF-') {
                    console.log('  ❌ PDF header invalid!');
                    return { success: false, size: stats.size };
                }
                
                return { success: true, size: stats.size };
            } catch (error) {
                console.log(`  ❌ PDF generation failed: ${error}`);
                return { success: false, size: 0 };
            }
        };

        // Generate Excel report
        const generateExcel = async (settingName: string): Promise<{ success: boolean; size: number }> => {
            const excelBtn = page.locator('button:has-text("Excel Данные"), button:has-text("Excel Data")').first();
            
            if (!await excelBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                console.log('  ⚠ Excel button not visible');
                return { success: false, size: 0 };
            }
            
            await expect(excelBtn).toBeEnabled({ timeout: 5000 });
            
            try {
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 60000 }),
                    excelBtn.click()
                ]) as [Download, unknown];
                
                const timestamp = Date.now();
                const filename = `${settingName}_${timestamp}.xlsx`;
                const savePath = path.resolve(TEST_OUTPUT_DIR, filename);
                await download.saveAs(savePath);
                
                const stats = fs.statSync(savePath);
                console.log(`  ✓ Excel: ${filename} (${stats.size} bytes)`);
                
                // Validate Excel
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.readFile(savePath);
                
                if (workbook.worksheets.length === 0) {
                    console.log('  ❌ Excel has no worksheets!');
                    return { success: false, size: stats.size };
                }
                
                const rowCount = workbook.worksheets[0].rowCount;
                console.log(`  ✓ Excel validated: ${workbook.worksheets.length} sheets, ${rowCount} rows`);
                
                return { success: true, size: stats.size };
            } catch (error) {
                console.log(`  ❌ Excel generation failed: ${error}`);
                return { success: false, size: 0 };
            }
        };

        // ═══════════════════════════════════════════════════════════════════
        // MAIN TEST
        // ═══════════════════════════════════════════════════════════════════
        
        // 1. Login and navigate to dashboard
        await page.goto('/dashboard');
        await waitForPageReady();
        
        // Use shared login helper with retry logic for 429 rate limiting
        await loginAsAdmin(page);
        
        await ensureNoModal();
        
        // 2. Load SWB demo file (has BOTH calibration AND pressure data)
        console.log('\n📂 Loading SWB demo file (with pressure data)...');
        await loadDemoFile(true); // preferPressureData = true for SWB
        console.log('✓ Demo file loaded');
        
        // 3. Navigate to Reports page
        console.log('\n📊 Navigating to Reports page...');
        const reportsLink = page.locator('nav a').filter({ hasText: /Отчёты|Reports/i }).first();
        await reportsLink.click();
        await page.waitForURL('**/reports', { timeout: 10000 });
        await waitForPageReady();
        console.log('✓ On Reports page');
        
        // Wait for page to be ready with data - check for "Генерация отчёта" or PDF button
        await page.waitForTimeout(2000);
        
        // Check if we have the "No data" message - if so, abort
        const noDataHeading = page.getByRole('heading', { name: /Нет данных для отчёта/i });
        if (await noDataHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log('\n❌ CRITICAL: No data on Reports page!');
            console.log('   This is a store persistence issue, not a report generation bug.');
            console.log('   Session storage may not be working in headless mode.');
            console.log('   Skipping report generation tests.\n');
            // Take screenshot for debugging
            await page.screenshot({ path: 'test-results/no-data-on-reports.png' });
            throw new Error('parseResult is null on Reports page - session storage not persisting');
        }
        
        // Wait for PDF button to appear (confirms data is available)
        const pdfButton = page.locator('button:has-text("PDF Отчёт"), button:has-text("PDF Report")').first();
        await expect(pdfButton).toBeVisible({ timeout: 10000 });
        console.log('✓ Report generation UI ready');
        
        // 4. Test each setting combination
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log(`Testing ${SETTINGS_COMBINATIONS.length} setting combinations...`);
        console.log('═══════════════════════════════════════════════════════════════');
        
        for (const settings of SETTINGS_COMBINATIONS) {
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`🔧 Testing: ${settings.name}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            
            try {
                // Apply settings
                await applySettings(settings);
                
                // Generate PDF
                const pdfResult = await generatePDF(settings.name);
                
                // Small delay between generations
                await page.waitForTimeout(500);
                
                // Generate Excel
                const excelResult = await generateExcel(settings.name);
                
                testResults[settings.name] = {
                    pdf: pdfResult.success,
                    excel: excelResult.success,
                    pdfSize: pdfResult.size,
                    excelSize: excelResult.size
                };
                
            } catch (error) {
                console.log(`❌ Error testing ${settings.name}: ${error}`);
                testResults[settings.name] = { pdf: false, excel: false, pdfSize: 0, excelSize: 0 };
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // FINAL SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('              REPORT COMBINATIONS TEST RESULTS                  ');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        let passedPDF = 0;
        let passedExcel = 0;
        const total = Object.keys(testResults).length;
        
        console.log('Setting Name                    | PDF      | Excel    | PDF Size  | Excel Size');
        console.log('--------------------------------|----------|----------|-----------|------------');
        
        for (const [name, result] of Object.entries(testResults)) {
            const pdfStatus = result.pdf ? '✅ PASS' : '❌ FAIL';
            const excelStatus = result.excel ? '✅ PASS' : '❌ FAIL';
            const pdfSize = result.pdfSize > 0 ? `${(result.pdfSize / 1024).toFixed(1)}KB` : '-';
            const excelSize = result.excelSize > 0 ? `${(result.excelSize / 1024).toFixed(1)}KB` : '-';
            
            console.log(`${name.padEnd(31)} | ${pdfStatus} | ${excelStatus} | ${pdfSize.padStart(9)} | ${excelSize.padStart(10)}`);
            
            if (result.pdf) passedPDF++;
            if (result.excel) passedExcel++;
        }
        
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log(`📊 PDF Reports:   ${passedPDF}/${total} passed`);
        console.log(`📊 Excel Reports: ${passedExcel}/${total} passed`);
        console.log(`📁 Output folder: ${TEST_OUTPUT_DIR}`);
        console.log('═══════════════════════════════════════════════════════════════');
        
        // At least 90% should pass
        expect(passedPDF).toBeGreaterThanOrEqual(Math.floor(total * 0.9));
        expect(passedExcel).toBeGreaterThanOrEqual(Math.floor(total * 0.9));
    });
});

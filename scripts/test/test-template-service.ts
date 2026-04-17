/**
 * Test that calls the TemplateExcelService directly with axis settings
 */

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

// Import the actual service
import { TemplateExcelService } from '../src/lib/services/TemplateExcelService';

async function runTest() {
    console.log('='.repeat(60));
    console.log('Testing TemplateExcelService with axis settings');
    console.log('='.repeat(60));

    // Create mock data with axis settings set to LEFT
    const mockData = {
        rawData: [
            { time_sec: 0, viscosity_cp: 100, temperature_c: 25, shear_rate: 10, pressure_bar: 0 },
            { time_sec: 60, viscosity_cp: 200, temperature_c: 30, shear_rate: 20, pressure_bar: 5 },
            { time_sec: 120, viscosity_cp: 300, temperature_c: 35, shear_rate: 30, pressure_bar: 10 },
            { time_sec: 180, viscosity_cp: 400, temperature_c: 38, shear_rate: 40, pressure_bar: 15 },
        ],
        metadata: {
            testId: 'TEST-001',
            testDate: '2024-12-31',
            operatorName: 'Test Operator'
        },
        recipe: [],
        waterParams: {},
        cycles: [],
        cycleResults: [],
        showPressure: true,
        showTemperature: true,
        showShearRate: true,
        shearRateAxis: 'left' as const,  // <-- This should move series 2 to left
        pressureAxis: 'left' as const,    // <-- This should move series 3 to left
        unitSystem: 'SI'
    };

    console.log('\nInput settings:');
    console.log(`  shearRateAxis: ${mockData.shearRateAxis}`);
    console.log(`  pressureAxis: ${mockData.pressureAxis}`);

    try {
        const buffer = await TemplateExcelService.generate(mockData);

        // Extract the chart XML from the generated file
        const zip = await JSZip.loadAsync(buffer);
        const chartXml = await zip.file('xl/charts/chart1.xml')?.async('string');

        if (!chartXml) {
            console.error('No chart XML found in output!');
            return;
        }

        // Check which series are in which chart
        const scatterChartPattern = /<c:scatterChart>[\s\S]*?<\/c:scatterChart>/g;
        const charts = chartXml.match(scatterChartPattern);

        if (!charts || charts.length < 2) {
            console.error(`Expected 2 scatterCharts, found ${charts?.length || 0}`);
            return;
        }

        console.log('\n--- RESULT ---');
        const primarySeries = [...charts[0].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]);
        const secondarySeries = [...charts[1].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]);

        console.log(`Primary chart (LEFT axis) series: ${primarySeries.join(', ')}`);
        console.log(`Secondary chart (RIGHT axis) series: ${secondarySeries.join(', ')}`);

        // Verify axis labels
        const worksheet = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
        if (worksheet) {
            // Check for axis labels in sharedStrings or worksheet
            console.log('\n--- AXIS LABELS ---');
        }

        // Verify
        const shearRateOnLeft = primarySeries.includes('2');
        const pressureOnLeft = primarySeries.includes('3');

        console.log('\n--- VERIFICATION ---');
        console.log(`Shear Rate (series 2) on LEFT axis: ${shearRateOnLeft ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Pressure (series 3) on LEFT axis: ${pressureOnLeft ? '✅ PASS' : '❌ FAIL'}`);

        if (shearRateOnLeft && pressureOnLeft) {
            console.log('\n✅✅✅ ALL TESTS PASSED! ✅✅✅');
        } else {
            console.log('\n❌❌❌ SOME TESTS FAILED! ❌❌❌');
        }

        // Save output for inspection
        const outputPath = path.join(process.cwd(), 'test-output', 'axis-test-output.xlsx');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, buffer);
        console.log(`\nOutput saved to: ${outputPath}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

runTest().catch(console.error);

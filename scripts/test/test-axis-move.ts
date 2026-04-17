/**
 * Test for TemplateExcelService.moveSeriesToPrimary
 * This test verifies that series are correctly moved from secondary to primary scatterChart
 */

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

// Read the template chart XML
async function getChartXml(): Promise<string> {
    const templatePath = path.join(process.cwd(), 'src', 'assets', 'report-template.xlsx');
    const buffer = fs.readFileSync(templatePath);
    const zip = await JSZip.loadAsync(buffer);
    const chartXml = await zip.file('xl/charts/chart1.xml')?.async('string');
    if (!chartXml) throw new Error('Chart not found in template');
    return chartXml;
}

// Copy of the moveSeriesToPrimary function for testing
function moveSeriesToPrimary(xml: string, seriesIdx: number): string {
    // Find all scatterChart blocks
    const scatterChartPattern = /<c:scatterChart>[\s\S]*?<\/c:scatterChart>/g;
    const scatterCharts = xml.match(scatterChartPattern);

    console.log(`[TEST] Found ${scatterCharts?.length || 0} scatterChart blocks`);

    if (!scatterCharts || scatterCharts.length < 2) {
        console.warn('[moveSeriesToPrimary] Expected 2 scatterChart blocks, found:', scatterCharts?.length || 0);
        return xml;
    }

    const primaryChart = scatterCharts[0];
    const secondaryChart = scatterCharts[1];

    console.log(`[TEST] Primary chart length: ${primaryChart.length}`);
    console.log(`[TEST] Secondary chart length: ${secondaryChart.length}`);

    // Find the series in the secondary chart
    const serPattern = /<c:ser>[\s\S]*?<\/c:ser>/g;
    let targetSeries = '';
    let secondaryChartModified = secondaryChart;

    const seriesMatches = secondaryChart.match(serPattern);
    console.log(`[TEST] Found ${seriesMatches?.length || 0} series in secondary chart`);

    if (seriesMatches) {
        for (const ser of seriesMatches) {
            const idxMatch = ser.match(/<c:idx val="(\d+)"\/>/);
            console.log(`[TEST] Series idx: ${idxMatch?.[1]}`);

            if (ser.includes(`<c:idx val="${seriesIdx}"/>`)) {
                targetSeries = ser;
                console.log(`[TEST] Found target series ${seriesIdx}, length: ${ser.length}`);
                // Remove the series from secondary chart
                secondaryChartModified = secondaryChart.replace(ser, '');
                console.log(`[TEST] Secondary chart after removal, length: ${secondaryChartModified.length}`);
                break;
            }
        }
    }

    if (!targetSeries) {
        console.warn(`[moveSeriesToPrimary] Series ${seriesIdx} not found in secondary chart`);
        return xml;
    }

    // Insert the series into primary chart (before <c:axId> tags)
    const axIdPos = primaryChart.indexOf('<c:axId');
    if (axIdPos === -1) {
        console.warn('[moveSeriesToPrimary] Could not find <c:axId> in primary chart');
        return xml;
    }

    console.log(`[TEST] Found <c:axId> at position ${axIdPos} in primary chart`);

    const primaryChartModified = primaryChart.substring(0, axIdPos) + targetSeries + primaryChart.substring(axIdPos);
    console.log(`[TEST] Primary chart after insertion, length: ${primaryChartModified.length}`);

    // CRITICAL FIX: Replace secondary chart FIRST (since it comes AFTER primary in XML)
    // Then replace primary chart. This ensures both replacements work correctly.
    console.log(`[TEST] Original XML length: ${xml.length}`);

    let newXml = xml.replace(secondaryChart, secondaryChartModified);
    console.log(`[TEST] After secondary replace, length: ${newXml.length}`);

    newXml = newXml.replace(primaryChart, primaryChartModified);
    console.log(`[TEST] After primary replace, length: ${newXml.length}`);

    // Verify the change
    const newScatterCharts = newXml.match(scatterChartPattern);
    if (newScatterCharts) {
        console.log(`[TEST] New primary chart has series with idx: ${[...newScatterCharts[0].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);
        console.log(`[TEST] New secondary chart has series with idx: ${[...newScatterCharts[1].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);
    }

    return newXml;
}

async function runTest() {
    console.log('='.repeat(60));
    console.log('Testing moveSeriesToPrimary function');
    console.log('='.repeat(60));

    const chartXml = await getChartXml();

    // Check initial state
    const scatterChartPattern = /<c:scatterChart>[\s\S]*?<\/c:scatterChart>/g;
    const initialCharts = chartXml.match(scatterChartPattern);

    if (!initialCharts || initialCharts.length < 2) {
        console.error('Template does not have 2 scatterChart blocks!');
        return;
    }

    console.log('\n--- INITIAL STATE ---');
    console.log(`Primary chart series: ${[...initialCharts[0].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);
    console.log(`Secondary chart series: ${[...initialCharts[1].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);

    // Test moving series 2 (Shear Rate) to primary axis
    console.log('\n--- MOVING SERIES 2 (Shear Rate) TO PRIMARY ---');
    const afterMove2 = moveSeriesToPrimary(chartXml, 2);

    const chartsAfter2 = afterMove2.match(scatterChartPattern);
    if (chartsAfter2) {
        console.log('\nAFTER MOVE:');
        console.log(`Primary chart series: ${[...chartsAfter2[0].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);
        console.log(`Secondary chart series: ${[...chartsAfter2[1].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);

        // Verify
        const primaryHas2 = chartsAfter2[0].includes('<c:idx val="2"/>');
        const secondaryHas2 = chartsAfter2[1].includes('<c:idx val="2"/>');

        console.log(`\n✅ Series 2 in primary: ${primaryHas2}`);
        console.log(`❌ Series 2 in secondary: ${secondaryHas2}`);

        if (primaryHas2 && !secondaryHas2) {
            console.log('\n✅✅✅ TEST PASSED: Series 2 successfully moved to primary axis! ✅✅✅');
        } else {
            console.log('\n❌❌❌ TEST FAILED: Series 2 was NOT moved correctly! ❌❌❌');
        }
    }

    // Also test moving series 3 (Pressure)
    console.log('\n--- MOVING SERIES 3 (Pressure) TO PRIMARY ---');
    const afterMove3 = moveSeriesToPrimary(afterMove2, 3);

    const chartsAfter3 = afterMove3.match(scatterChartPattern);
    if (chartsAfter3) {
        console.log('\nAFTER MOVE:');
        console.log(`Primary chart series: ${[...chartsAfter3[0].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);
        console.log(`Secondary chart series: ${[...chartsAfter3[1].matchAll(/<c:idx val="(\d+)"\/>/g)].map(m => m[1]).join(', ')}`);

        const primaryHas3 = chartsAfter3[0].includes('<c:idx val="3"/>');
        const secondaryHas3 = chartsAfter3[1].includes('<c:idx val="3"/>');

        if (primaryHas3 && !secondaryHas3) {
            console.log('\n✅✅✅ TEST PASSED: Series 3 successfully moved to primary axis! ✅✅✅');
        } else {
            console.log('\n❌❌❌ TEST FAILED: Series 3 was NOT moved correctly! ❌❌❌');
        }
    }
}

runTest().catch(console.error);

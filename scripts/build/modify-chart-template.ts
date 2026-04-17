/**
 * Script to modify the chart template - change Shear Rate series to thin cyan line
 */

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

async function modifyTemplate() {
    const templatePath = path.join(process.cwd(), 'src', 'assets', 'report-template.xlsx');
    const buffer = fs.readFileSync(templatePath);
    const zip = await JSZip.loadAsync(buffer);

    let chartXml = await zip.file('xl/charts/chart1.xml')?.async('string');
    if (!chartXml) {
        console.error('Chart not found!');
        return;
    }

    console.log('=== BEFORE ===');

    // Find all series and their styles
    const seriesPattern = /<c:ser>[\s\S]*?<\/c:ser>/g;
    const allSeries = chartXml.match(seriesPattern);

    if (allSeries) {
        for (const ser of allSeries) {
            const idxMatch = ser.match(/<c:idx val="(\d+)"\/>/);
            const nameMatch = ser.match(/<c:v>([^<]+)<\/c:v>/);
            const styleMatch = ser.match(/<c:spPr>([\s\S]*?)<\/c:spPr>/);

            if (idxMatch) {
                console.log(`\nSeries ${idxMatch[1]}: ${nameMatch?.[1] || 'unknown'}`);
                console.log(`  Style: ${styleMatch?.[0] || 'none'}`);
            }
        }
    }

    // Find and modify Shear Rate series (contains "Скорость сдвига" or idx=2)
    // Replace color A855F7 with 06B6D4 and width 19050 with 9525
    // Using a more flexible approach - replace within the series block

    chartXml = chartXml.replace(
        /(<c:ser><c:idx val="2"\/>[\s\S]*?<c:spPr><a:ln w=")(\d+)("><a:solidFill><a:srgbClr val=")([A-F0-9]+)("\/><\/a:solidFill>)/,
        '$19525$306B6D4$5'
    );

    console.log('\n\n=== AFTER ===');

    const allSeriesAfter = chartXml.match(seriesPattern);
    if (allSeriesAfter) {
        for (const ser of allSeriesAfter) {
            const idxMatch = ser.match(/<c:idx val="(\d+)"\/>/);
            const nameMatch = ser.match(/<c:v>([^<]+)<\/c:v>/);
            const styleMatch = ser.match(/<c:spPr>([\s\S]*?)<\/c:spPr>/);

            if (idxMatch) {
                console.log(`\nSeries ${idxMatch[1]}: ${nameMatch?.[1] || 'unknown'}`);
                console.log(`  Style: ${styleMatch?.[0] || 'none'}`);
            }
        }
    }

    // Save the modified template
    zip.file('xl/charts/chart1.xml', chartXml);

    const newBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(templatePath, newBuffer);

    console.log('\n\n✅ Template updated successfully!');
}

modifyTemplate().catch(console.error);

const fs = require('fs');
const JSZip = require('jszip');

async function main() {
    const buffer = fs.readFileSync('src/assets/report-template.xlsx');
    const zip = await JSZip.loadAsync(buffer);
    const chartXml = await zip.file('xl/charts/chart1.xml').async('string');
    console.log(chartXml);
}

main().catch(e => console.error(e));

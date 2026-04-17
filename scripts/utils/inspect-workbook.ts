
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

async function inspectWorkbook() {
    const dir = path.join(process.cwd(), 'test-output');
    const files = fs.readdirSync(dir).filter(f => f.startsWith('test-chart-native-') && f.endsWith('.xlsx'));
    const latest = files.sort().pop();

    if (!latest) return;

    const buffer = fs.readFileSync(path.join(dir, latest));
    const zip = await JSZip.loadAsync(buffer);

    const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
    console.log('\n--- workbook.xml (Defined Names check) ---');
    if (workbookXml?.includes('<definedNames>')) {
        const start = workbookXml.indexOf('<definedNames>');
        const end = workbookXml.indexOf('</definedNames>') + 15;
        console.log(workbookXml.substring(start, end));
    } else {
        console.log('NO <definedNames> FOUND!');
    }
}

inspectWorkbook().catch(console.error);

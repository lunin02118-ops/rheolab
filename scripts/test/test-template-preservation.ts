
import ExcelJS from 'exceljs';
import path from 'path';

async function test() {
    const templatePath = path.join(process.cwd(), 'src', 'assets', 'report-template.xlsx');
    const outputPath = path.join(process.cwd(), 'test-output', 'test-preserved.xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    // Just save it immediately
    await workbook.xlsx.writeFile(outputPath);

    console.log(`Saved to ${outputPath}`);
}

test().catch(console.error);

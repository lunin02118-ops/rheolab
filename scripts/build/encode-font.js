const fs = require('fs');
const path = require('path');

const fontPath = path.join(__dirname, '../public/fonts/Roboto-Regular.ttf');
try {
    if (fs.existsSync(fontPath)) {
        const buffer = fs.readFileSync(fontPath);
        const content = `export const robotoRegular = '${buffer.toString('base64')}';`;
        fs.writeFileSync(path.join(__dirname, '../src/components/reports/pdf/roboto-font.ts'), content);
        console.log('Font encoded successfully');
    } else {
        console.error('Font file not found:', fontPath);
        process.exit(1);
    }
} catch (e) {
    console.error(e);
    process.exit(1);
}

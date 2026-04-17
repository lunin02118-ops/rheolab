const fs = require('fs');
const path = require('path');
// pdf-parse default export is a function: pdf(buffer) -> Promise<{text, numpages}>
const pdf = require('pdf-parse');

const TDS_DIR = path.join(__dirname, 'tds_files');
const OUT_DIR = path.join(__dirname, 'tds_txt');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(TDS_DIR).filter(f => f.endsWith('.pdf'));

(async () => {
  let ok = 0, fail = 0;
  for (const file of files) {
    const outFile = path.join(OUT_DIR, file.replace('.pdf', '.txt'));
    try {
      const buf = fs.readFileSync(path.join(TDS_DIR, file));
      const data = await pdf(buf);
      fs.writeFileSync(outFile, data.text, 'utf8');
      const lines = data.text.split('\n').length;
      console.log(`  OK   ${file} -> ${lines} lines`);
      ok++;
    } catch (e) {
      console.log(`  FAIL ${file}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} OK, ${fail} FAIL`);
})();

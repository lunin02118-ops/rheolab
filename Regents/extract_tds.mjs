import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TDS_DIR = path.join(__dirname, 'tds_files');
const OUT_DIR = path.join(__dirname, 'tds_txt');

fs.mkdirSync(OUT_DIR, { recursive: true });

// Resolve worker via package resolution (portable across workspace layouts)
const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = `file:///${workerPath.replace(/\\/g, '/')}`;

async function extractText(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    text += `\n--- Page ${i} ---\n${pageText}\n`;
  }
  return { text, numPages: doc.numPages };
}

const files = fs.readdirSync(TDS_DIR).filter(f => f.endsWith('.pdf'));
let ok = 0, fail = 0;

for (const file of files) {
  const outFile = path.join(OUT_DIR, file.replace('.pdf', '.txt'));
  try {
    const { text, numPages } = await extractText(path.join(TDS_DIR, file));
    fs.writeFileSync(outFile, text, 'utf8');
    console.log(`  OK   ${file} (${numPages} pages, ${text.length} chars)`);
    ok++;
  } catch (e) {
    console.log(`  FAIL ${file}: ${e.message}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} OK, ${fail} FAIL`);

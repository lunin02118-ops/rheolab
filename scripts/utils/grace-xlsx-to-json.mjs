/**
 * One-time script: convert the Grace .xlsx fixture into a JSON snapshot
 * so that the website no longer requires the vulnerable xlsx@0.18.5 package.
 *
 * Usage:  node scripts/utils/grace-xlsx-to-json.mjs
 * Output: tests/fixtures/grace-fixture.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'Отчёт Grace.xlsx');
const workbook = XLSX.readFile(fixturePath);
const sheet = workbook.Sheets['1908 buff2'] ?? workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
const headerIndex = rows.findIndex((row) => row[0] === 'Ramp NO');

if (headerIndex === -1) {
  throw new Error('Grace fixture header row not found');
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function toBar(psi) {
  return psi * 0.0689476;
}

const points = rows
  .slice(headerIndex + 1)
  .filter((row) => (
    typeof row[3] === 'number'
    && typeof row[4] === 'number'
    && typeof row[5] === 'number'
    && typeof row[6] === 'number'
    && typeof row[7] === 'number'
    && typeof row[8] === 'number'
    && typeof row[9] === 'number'
  ))
  .map((row) => ({
    time: round(row[3], 2),
    temperature: round(row[4], 1),
    pressurePsi: round(row[5], 2),
    pressureBar: round(toBar(row[5]), 1),
    rpm: round(row[6], 3),
    shear: round(row[7], 2),
    shearStress: round(row[8], 3),
    viscosity: round(row[9], 3),
    bathTemperature: round(typeof row[10] === 'number' ? row[10] : row[4], 1),
  }));

const outPath = join(process.cwd(), 'tests', 'fixtures', 'grace-fixture.json');
writeFileSync(outPath, JSON.stringify(points, null, 2));
console.log(`Wrote ${points.length} points to ${outPath}`);

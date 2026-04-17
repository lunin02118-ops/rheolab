/**
 * One-time script: convert the legacy .xls Grace fixture into a JSON snapshot
 * so that the test no longer requires the vulnerable xlsx@0.18.5 package.
 *
 * Usage:  node scripts/utils/xls-to-json.mjs
 * Output: tests/fixtures/t-20.02.26-1-561-110C.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const FIXTURE = 't-20.02.26-1  - 561)@110C.xls';
const fixturePath = join(process.cwd(), 'tests', 'fixtures', FIXTURE);
const rawBuffer = readFileSync(fixturePath);
const wb = XLSX.read(rawBuffer, { type: 'buffer', raw: true });

const ws = wb.Sheets['Raw Data'];
if (!ws) throw new Error('Sheet "Raw Data" not found');

const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

const points = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r[0] == null) continue;

  const timeStr = r[10];
  if (!timeStr || typeof timeStr !== 'string') continue;

  const parts = timeStr.split(':');
  if (parts.length !== 3) continue;

  const timeSec =
    parseInt(parts[0], 10) * 3600 +
    parseInt(parts[1], 10) * 60 +
    parseInt(parts[2], 10);

  const viscosity = parseFloat(String(r[0]));
  const shearRate = parseFloat(String(r[4]));

  if (!isFinite(timeSec) || !isFinite(viscosity)) continue;

  points.push({
    time_min: +(timeSec / 60).toFixed(4),
    viscosity_cp: +viscosity.toFixed(4),
    shear_rate: isFinite(shearRate) ? +shearRate.toFixed(4) : 0,
  });
}

const outPath = join(process.cwd(), 'tests', 'fixtures', 't-20.02.26-1-561-110C.json');
writeFileSync(outPath, JSON.stringify(points, null, 2));
console.log(`Wrote ${points.length} points to ${outPath}`);

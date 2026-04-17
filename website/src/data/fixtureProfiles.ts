import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

export type FixtureProfileKey = 'grace';

export interface FixturePoint {
  time: number;
  viscosity: number;
  temperature: number;
  pressureBar: number;
  pressurePsi: number;
  shear: number;
  shearStress: number;
  rpm: number;
  bathTemperature: number;
}

export interface FixtureStats {
  maxViscosity: number;
  avgViscosity: number;
  avgTemperature: number;
  maxPressure: number;
  duration: number;
}

export interface FixtureProfile {
  label: string;
  note: string;
  source: string;
  instrumentType: string;
  geometry: string;
  geometrySource: 'context';
  highlightTime: number;
  highlight: FixturePoint;
  stats: FixtureStats;
  points: FixturePoint[];
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function toBar(psi: number) {
  return psi * 0.0689476;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function loadGraceFixture(): FixtureProfile {
  const workbookPath = fileURLToPath(new URL('../../../tests/fixtures/Отчёт Grace.xlsx', import.meta.url));
  const workbook = XLSX.readFile(workbookPath);
  const sheet = workbook.Sheets['1908 buff2'] ?? workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as Array<Array<number | string | null>>;
  const headerIndex = rows.findIndex((row) => row[0] === 'Ramp NO');

  if (headerIndex === -1) {
    throw new Error('Grace fixture header row not found');
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
      time: round(row[3] as number, 2),
      temperature: round(row[4] as number, 1),
      pressurePsi: round(row[5] as number, 2),
      pressureBar: round(toBar(row[5] as number), 1),
      rpm: round(row[6] as number, 3),
      shear: round(row[7] as number, 2),
      shearStress: round(row[8] as number, 3),
      viscosity: round(row[9] as number, 3),
      bathTemperature: round(typeof row[10] === 'number' ? row[10] as number : row[4] as number, 1),
    }));

  if (points.length === 0) {
    throw new Error('Grace fixture contains no points');
  }

  const highlightTime = 58.63;
  const highlight = points.reduce((closest, point) => (
    Math.abs(point.time - highlightTime) < Math.abs(closest.time - highlightTime) ? point : closest
  ));

  return {
    label: 'Отчёт Grace',
    note: 'График построен по файлу отчёта Grace',
    source: 'tests/fixtures/Отчёт Grace.xlsx',
    instrumentType: 'Grace M5600',
    geometry: 'R1B5',
    geometrySource: 'context',
    highlightTime,
    highlight,
    stats: {
      maxViscosity: Math.round(Math.max(...points.map((point) => point.viscosity))),
      avgViscosity: Math.round(average(points.map((point) => point.viscosity))),
      avgTemperature: Math.round(average(points.map((point) => point.temperature))),
      maxPressure: round(Math.max(...points.map((point) => point.pressureBar)), 1),
      duration: Math.round(points[points.length - 1]?.time ?? 0),
    },
    points,
  };
}

export const fixtureProfiles: Record<FixtureProfileKey, FixtureProfile> = {
  grace: loadGraceFixture(),
};

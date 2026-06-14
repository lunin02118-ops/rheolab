import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRootFrom } from '../lib/repo-root';

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

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Load pre-parsed Grace fixture from a JSON snapshot.
 *
 * The JSON was generated from `tests/fixtures/Отчёт Grace.xlsx` by
 * `scripts/utils/grace-xlsx-to-json.mjs` (one-time conversion).
 * This avoids a runtime dependency on the vulnerable `xlsx` package.
 */
function loadGraceFixture(): FixtureProfile {
  const repoRoot = findRepoRootFrom(import.meta.url);
  const jsonPath = resolve(repoRoot, 'tests/fixtures/grace-fixture.json');
  const points: FixturePoint[] = JSON.parse(readFileSync(jsonPath, 'utf-8'));

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

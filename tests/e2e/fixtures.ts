/**
 * E2E Test Fixtures — catalog of test data files and their expected properties.
 *
 * Each fixture describes a real instrument data file located in `tests/fixtures/`.
 * Tests import this list to parameterize file-loading and parsing scenarios.
 */

export interface TestFixture {
  /** File name inside `tests/fixtures/` */
  fileName: string;
  /** Human-readable label used as a demo-file button */
  displayName: string;
  /** Instrument manufacturer / type (used for filter assertions) */
  instrument: string;
  /** Expected file format extension */
  format: 'csv' | 'xlsx' | 'xls' | 'dat';
  /** Whether it is available as a demo-file button on the dashboard */
  isDemoFile: boolean;
  /** Minimum expected number of analysis cycles (0 = don't check) */
  minCycles: number;
}

// ---------- Chandler ----------

export const CHANDLER_SST_63: TestFixture = {
  fileName: '8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv',
  displayName: 'Chandler SST',
  instrument: 'Chandler',
  format: 'csv',
  isDemoFile: true,
  minCycles: 1,
};

export const CHANDLER_SWB_96: TestFixture = {
  fileName: '8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv',
  displayName: 'Chandler SWB',
  instrument: 'Chandler',
  format: 'csv',
  isDemoFile: true,
  minCycles: 1,
};

export const CHANDLER_5610: TestFixture = {
  fileName: '3.8_2.0_0.2_41C(5610_56)23.04.csv',
  displayName: 'Chandler 5610',
  instrument: 'Chandler',
  format: 'csv',
  isDemoFile: false,
  minCycles: 1,
};

export const CHANDLER_REPORT: TestFixture = {
  fileName: 'Отчёт Chandler.xls',
  displayName: 'Chandler Report',
  instrument: 'Chandler',
  format: 'xls',
  isDemoFile: false,
  minCycles: 1,
};

// ---------- Grace ----------

export const GRACE_REPORT: TestFixture = {
  fileName: 'Отчёт Grace.xlsx',
  displayName: 'Grace Report',
  instrument: 'Grace',
  format: 'xlsx',
  isDemoFile: true,
  minCycles: 1,
};

// ---------- Brookfield ----------

export const BROOKFIELD_4: TestFixture = {
  fileName: 'Brookfeild 4.xlsx',
  displayName: 'Brookfield 4',
  instrument: 'Brookfield',
  format: 'xlsx',
  isDemoFile: true,
  minCycles: 1,
};

export const BROOKFIELD_REPORT: TestFixture = {
  fileName: 'Отчёт brookfild.xls',
  displayName: 'Brookfield Report',
  instrument: 'Brookfield',
  format: 'xls',
  isDemoFile: false,
  minCycles: 1,
};

// ---------- BSL ----------

export const BSL_REPORT: TestFixture = {
  fileName: 'Отчёт BSL.xlsx',
  displayName: 'BSL Report',
  instrument: 'BSL',
  format: 'xlsx',
  isDemoFile: true,
  minCycles: 1,
};

// ---------- Ofite ----------

export const OFITE_1100: TestFixture = {
  fileName: 'Ofite 1100.dat',
  displayName: 'Ofite 1100',
  instrument: 'Ofite',
  format: 'dat',
  isDemoFile: true,
  minCycles: 1,
};

// ---------- Grace Excel ----------

export const GRACE_NOVEMBER: TestFixture = {
  fileName: 'November102008-2.xls',
  displayName: 'Grace November 2008',
  instrument: 'Grace',
  format: 'xls',
  isDemoFile: false,
  minCycles: 1,
};

// ---------- SWB ----------

export const SWB_90: TestFixture = {
  fileName: '90 второй 26.02.2024 1717.da.xlsx',
  displayName: 'SWB 90',
  instrument: 'SWB',
  format: 'xlsx',
  isDemoFile: false,
  minCycles: 1,
};

// ============ Aggregates ============

/** All fixtures available as demo-file buttons on the dashboard */
export const DEMO_FIXTURES: TestFixture[] = [
  CHANDLER_SST_63,
  CHANDLER_SWB_96,
  GRACE_REPORT,
  BROOKFIELD_4,
  BSL_REPORT,
  OFITE_1100,
];

/** All fixtures that require file-input upload (not in demo list) */
export const UPLOAD_FIXTURES: TestFixture[] = [
  CHANDLER_5610,
  CHANDLER_REPORT,
  BROOKFIELD_REPORT,
  GRACE_NOVEMBER,
  SWB_90,
];

/** Every fixture */
export const ALL_FIXTURES: TestFixture[] = [...DEMO_FIXTURES, ...UPLOAD_FIXTURES];

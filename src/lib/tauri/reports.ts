/**
 * Tauri Reports, Fixtures & Parsing Commands
 *
 * Wraps report generation (PDF/Excel), test fixture listing/reading/parsing,
 * and the general file-parsing command.
 */

import { safeInvoke as invoke } from './core';
import type {
  FixtureReadResponse,
  FixtureSummaryResponse,
  ParseFileRequest,
  ParseFileResponse,
} from '@/types/tauri';

// ── Native Report Commands ────────────────────────────────────────────────────

export const reports = {
  /**
   * Generate PDF report bytes using native Rust report engine.
   * Binary IPC via tauri::ipc::Response — no JSON serialisation overhead.
   * Input is deserialised directly to a typed `ReportInput` struct on the Rust
   * side — no intermediate `serde_json::Value` or re-serialisation step.
   */
  async generatePdf(input: unknown): Promise<Uint8Array> {
    const buffer = await invoke<ArrayBuffer>('reports_generate_pdf', { input });
    return new Uint8Array(buffer);
  },

  /**
   * Generate Excel report bytes using native Rust report engine.
   * Binary IPC via tauri::ipc::Response — no JSON serialisation overhead.
   * Input is deserialised directly to a typed `ReportInput` struct on the Rust
   * side — no intermediate `serde_json::Value` or re-serialisation step.
   */
  async generateExcel(input: unknown): Promise<Uint8Array> {
    const buffer = await invoke<ArrayBuffer>('reports_generate_excel', { input });
    return new Uint8Array(buffer);
  },

  /**
   * Generate a multi-experiment comparison PDF (page 1 = shared chart +
   * summary, pages 2..N+1 = per-experiment bodies).
   *
   * Input is deserialised on the Rust side directly as
   * `ComparisonReportInput` — the TS caller is expected to pass the output
   * of `convertComparisonReportInputToWasm` (snake_case wire shape).
   */
  async generateComparisonPdf(input: unknown): Promise<Uint8Array> {
    const buffer = await invoke<ArrayBuffer>('reports_generate_comparison_pdf', { input });
    return new Uint8Array(buffer);
  },

  /**
   * Generate a multi-experiment comparison XLSX workbook (Summary sheet +
   * per-experiment sheets + hidden DebugInfo).  Same payload shape as
   * `generateComparisonPdf`.
   */
  async generateComparisonExcel(input: unknown): Promise<Uint8Array> {
    const buffer = await invoke<ArrayBuffer>('reports_generate_comparison_excel', { input });
    return new Uint8Array(buffer);
  },
};

// ── Test Fixtures Commands ────────────────────────────────────────────────────

export const fixtures = {
  /**
   * List available demo fixture files.
   */
  async list(): Promise<FixtureSummaryResponse> {
    return invoke<FixtureSummaryResponse>('test_fixtures_list');
  },

  /**
   * Read fixture file bytes for local parsing in desktop mode.
   */
  async read(filename: string): Promise<FixtureReadResponse> {
    return invoke<FixtureReadResponse>('test_fixtures_read', { filename });
  },

  /**
   * Parse fixture directly via native Rust parser (desktop-first path).
   */
  async parse(filename: string): Promise<ParseFileResponse> {
    return invoke<ParseFileResponse>('test_fixtures_parse', {
      filename,
    });
  },
};

// ── Native Parsing Commands ───────────────────────────────────────────────────

export const parsing = {
  /**
   * Parse rheology file bytes natively in Tauri (Rust).
   */
  async parseFile(request: ParseFileRequest): Promise<ParseFileResponse> {
    return invoke<ParseFileResponse>('parsing_parse_file', { request });
  },

  /**
   * Release the Rust-side file parse cache and run PRAGMA shrink_memory
   * on SQLite to return page-cache memory to the OS.
   *
   * Call after closing an experiment to reduce resident memory.
   */
  async releaseCache(): Promise<void> {
    return invoke<void>('parsing_release_cache');
  },
};

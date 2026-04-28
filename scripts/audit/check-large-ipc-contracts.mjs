#!/usr/bin/env node
/**
 * P14 / Sprint 0 — large-IPC contract lint.
 *
 * Scans every `#[tauri::command]` function in `src-tauri/src/commands` and
 * flags signatures that ferry large unstructured payloads across the
 * Tauri IPC boundary.  These payloads are either expensive to serialise
 * (JSON encode → string → JSON decode → JS Array → Float64Array) or
 * mask a missing typed DTO that the architectural plan wants us to keep
 * lean.  See `docs/perf/BUDGETS.md` and the architectural review.
 *
 * Forbidden by default:
 *   * `Vec<f64>` / `Vec<f32>`  — large numeric arrays in IPC.  Use
 *      `tauri::ipc::Response` + binary encoding, or a downsampled DTO,
 *      or a by-ids/by-handle command.
 *   * `Vec<RawPoint>` / `Vec<DataPoint>`  — raw time-series points in
 *      IPC.  Same rule.
 *   * `serde_json::Value` parameter  — prefer a typed DTO so the lint
 *      can see the shape and so we get free schema validation.
 *
 * Suppression: place a comment that contains the marker
 *   // LARGE-IPC-EXCEPTION: <reason>
 * within 5 lines above the `pub (async) fn` declaration.  CI greps for
 * the marker so every exception is auditable.
 *
 * Exit codes:
 *   0  no violations (or every violation is suppressed)
 *   1  one or more violations
 *   2  internal error (e.g. command dir not found)
 *
 * Run:
 *   npm run audit:large-ipc
 *   node scripts/audit/check-large-ipc-contracts.js
 *
 * The lint is intentionally regex-based, not a full Rust parser.  False
 * negatives are acceptable (we will catch them in code review); false
 * positives are not, hence the strict signature scope (only the lines
 * between `#[tauri::command]` and the opening `{` of the function body).
 */

import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const COMMANDS_DIR = join(ROOT, "src-tauri", "src", "commands");

const EXCEPTION_MARKER = "LARGE-IPC-EXCEPTION";
const PRECEDING_LINES = 5;

const FORBIDDEN = [
  {
    re: /Vec\s*<\s*f64\s*>/,
    label: "Vec<f64>",
    hint: "large numeric array in IPC — prefer tauri::ipc::Response with a binary encoding (postcard / custom header) or a downsampled DTO",
  },
  {
    re: /Vec\s*<\s*f32\s*>/,
    label: "Vec<f32>",
    hint: "large numeric array in IPC — prefer tauri::ipc::Response with a binary encoding or downsampled DTO",
  },
  {
    re: /Vec\s*<\s*RawPoint\s*>/,
    label: "Vec<RawPoint>",
    hint: "raw time-series points in IPC — prefer a binary stream or a by-ids command that loads from SQLite directly",
  },
  {
    re: /Vec\s*<\s*DataPoint\s*>/,
    label: "Vec<DataPoint>",
    hint: "raw time-series points in IPC — prefer a binary stream or a by-ids command",
  },
  {
    re: /serde_json::Value/,
    label: "serde_json::Value",
    hint: "untyped JSON parameter — prefer a typed DTO so the IPC contract is statically visible and gets free schema validation",
  },
];

async function* walkRustFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return;
    }
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkRustFiles(full);
    } else if (entry.isFile() && full.endsWith(".rs")) {
      yield full;
    }
  }
}

/**
 * Scan a single file for #[tauri::command] signatures and check them
 * against the forbidden patterns.
 */
function scanFile(text) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/#\[tauri::command\]/.test(line)) continue;

    // Find the next `pub (async) fn ...` line — skip any other attribute lines
    // that might sit between #[tauri::command] and the fn declaration.
    let fnLine = -1;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      if (/^\s*pub\s+(async\s+)?fn\s+(\w+)/.test(lines[j])) {
        fnLine = j;
        break;
      }
    }
    if (fnLine === -1) continue;

    const fnMatch = lines[fnLine].match(/^\s*pub\s+(async\s+)?fn\s+(\w+)/);
    const commandName = fnMatch ? fnMatch[2] : "<unknown>";

    // Collect the entire signature: from fnLine until the first line that
    // contains `{` (or `->` followed by something opening a block).  Cap
    // at 25 lines to avoid runaway scanning on malformed input.
    const sigLines = [];
    for (let k = fnLine; k < Math.min(lines.length, fnLine + 25); k++) {
      sigLines.push(lines[k]);
      if (lines[k].includes("{")) break;
    }
    const signature = sigLines.join("\n");

    // Suppression: scan the 5 lines preceding the #[tauri::command] for
    // an exception marker.  We deliberately put the marker BEFORE the
    // attribute, not in a doc comment of the fn itself, so it shows up
    // in the diff every time someone reorders attributes.
    const start = Math.max(0, i - PRECEDING_LINES);
    const preceding = lines.slice(start, i).join("\n");
    const exceptionMatch = preceding.match(
      new RegExp(`${EXCEPTION_MARKER}\\s*:?\\s*([^\\n]+)`),
    );
    const suppressed = exceptionMatch !== null;
    const reason = exceptionMatch ? exceptionMatch[1].trim() : "";

    for (const rule of FORBIDDEN) {
      if (rule.re.test(signature)) {
        findings.push({
          line: fnLine + 1, // 1-indexed for editor jumping
          command: commandName,
          pattern: rule.label,
          hint: rule.hint,
          suppressed,
          reason,
        });
      }
    }
  }
  return findings;
}

async function main() {
  const startedAt = Date.now();
  let scanned = 0;
  let totalFindings = 0;
  let unsuppressed = 0;
  const suppressed = [];
  const violations = [];

  for await (const file of walkRustFiles(COMMANDS_DIR)) {
    scanned += 1;
    const text = await fs.readFile(file, "utf8");
    const findings = scanFile(text);
    if (findings.length === 0) continue;
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    for (const f of findings) {
      totalFindings += 1;
      const entry = { file: rel, ...f };
      if (f.suppressed) {
        suppressed.push(entry);
      } else {
        unsuppressed += 1;
        violations.push(entry);
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;

  console.log(
    `[check-large-ipc-contracts] scanned ${scanned} .rs files in ${elapsedMs} ms`,
  );

  if (suppressed.length > 0) {
    console.log("");
    console.log(
      `Suppressed (${suppressed.length}) — auditable via grep "${EXCEPTION_MARKER}":`,
    );
    for (const v of suppressed) {
      console.log(`  ${v.file}:${v.line}  ${v.command}  ${v.pattern}`);
      if (v.reason) console.log(`    reason: ${v.reason}`);
    }
  }

  if (unsuppressed === 0) {
    console.log("");
    console.log(
      totalFindings === 0
        ? "OK — no large-IPC contract violations."
        : `OK — ${totalFindings} finding(s), all suppressed.`,
    );
    process.exit(0);
  }

  console.log("");
  console.log(`FAIL — ${unsuppressed} unsuppressed violation(s):`);
  console.log("");
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}`);
    console.log(`    command: ${v.command}`);
    console.log(`    pattern: ${v.pattern}`);
    console.log(`    hint:    ${v.hint}`);
    console.log("");
  }
  console.log("To suppress a known-acceptable case, add a comment within");
  console.log(`${PRECEDING_LINES} lines BEFORE the #[tauri::command] attribute:`);
  console.log("");
  console.log("    // LARGE-IPC-EXCEPTION: <one-line reason>");
  console.log("");
  console.log("Every suppression must include a reason — they are scanned by CI.");
  process.exit(1);
}

// Only run when invoked as the entrypoint, not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[check-large-ipc-contracts] internal error:", err);
    process.exit(2);
  });
}

export { scanFile, FORBIDDEN, EXCEPTION_MARKER, PRECEDING_LINES };

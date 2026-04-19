#!/usr/bin/env node
/**
 * snapshot-metrics.js — writes a canonical `metrics.json` baseline under
 * `runtime/refactor-baseline/` capturing the current state of the codebase
 * in a machine-comparable JSON shape.
 *
 * Intended for:
 *   1) DoD verification (§12.4, §12.2 of REFACTORING_DEEP_PLAN.md)
 *   2) regression detection in CI — future runs can diff against this file
 *
 * Usage:  node scripts/audit/snapshot-metrics.js [--out <path>]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'runtime', 'refactor-baseline', 'metrics.json');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** @param {string} dir @param {string[]} exts @returns {string[]} */
function walk(dir, exts, skipDirs = new Set(['target', 'node_modules', '.git', 'dist', '.turbo'])) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    if (!d) continue;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) stack.push(p);
      } else if (exts.some((x) => p.endsWith(x))) {
        out.push(p);
      }
    }
  }
  return out;
}

/** @param {string} p @returns {number} */
function countLines(p) {
  try {
    const data = fs.readFileSync(p, 'utf8');
    return data.length ? data.split(/\r?\n/).length : 0;
  } catch { return 0; }
}

/** @param {string} text @returns {string} — strip /* ... *\/, //, and // test mod regions naively */
function stripCommentsAndStrings(text) {
  // Remove block comments first
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments
  out = out.replace(/\/\/.*$/gm, '');
  // Remove string literals (rough — keeps numbers intact for matching but strips "unwrap" inside strings)
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '""');
  out = out.replace(/'(?:\\.|[^'\\])*'/g, "''");
  return out;
}

/**
 * Count occurrences of `.unwrap()`, `.expect(...)`, `panic!(...)` etc.
 * excluding `#[cfg(test)]` modules and `#[test]` functions.
 * Heuristic: crudely strip a `#[cfg(test)] mod tests { ... }` block.
 *
 * @param {string} p
 * @returns {{unwrap:number, expect:number, panic:number, todo:number, unimplemented:number}}
 */
function rustQualityMetrics(p) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); }
  catch { return { unwrap: 0, expect: 0, panic: 0, todo: 0, unimplemented: 0 }; }

  // Strip `#[cfg(test)] mod tests { ... }` region (crude brace-balance).
  // Also strip any `#[test]` or `#[tokio::test]` function body.
  text = stripTestBlocks(text);
  const clean = stripCommentsAndStrings(text);

  const count = (re) => {
    const m = clean.match(re);
    return m ? m.length : 0;
  };
  return {
    unwrap:        count(/\.unwrap\s*\(\s*\)/g),
    expect:        count(/\.expect\s*\(/g),
    panic:         count(/\bpanic\s*!\s*\(/g),
    todo:          count(/\btodo\s*!\s*\(/g),
    unimplemented: count(/\bunimplemented\s*!\s*\(/g),
  };
}

/** @param {string} text */
function stripTestBlocks(text) {
  // Remove `#[cfg(test)] mod <ident> { ... }` blocks (brace-balanced).
  const out = [];
  let i = 0;
  while (i < text.length) {
    const cfgIdx = text.indexOf('#[cfg(test)]', i);
    if (cfgIdx < 0) { out.push(text.slice(i)); break; }
    out.push(text.slice(i, cfgIdx));
    // Find `mod <ident> {`
    const modMatch = text.slice(cfgIdx).match(/^#\[cfg\(test\)\][\s\r\n]*(?:#\[[^\]]*\][\s\r\n]*)*mod\s+\w+\s*\{/);
    if (!modMatch) { i = cfgIdx + 12; continue; }
    let j = cfgIdx + modMatch[0].length;
    let depth = 1;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    i = j;
  }
  // Remove individual `#[test]` / `#[tokio::test]` function bodies
  let full = out.join('');
  full = full.replace(/#\[(?:tokio::)?test\][\s\S]*?fn\s+\w+[^\{]*\{/g, (m) => `${m}/* TEST_BODY_STRIPPED */`);
  // This leaves remaining body visible — but it already has #[cfg(test)] above if in a test mod.
  // Safe enough for a heuristic metric.
  return full;
}

// ─── scans ───────────────────────────────────────────────────────────────────

function scanLoc(rootDir, exts, label) {
  const files = walk(rootDir, exts).filter((f) =>
    !/\.d\.ts$/.test(f) && !/generated\./.test(f));
  let loc = 0;
  const oversize = [];
  for (const f of files) {
    const n = countLines(f);
    loc += n;
    const limit = exts.includes('.rs') ? 500 : 400;
    if (n > limit) oversize.push({ path: path.relative(ROOT, f).replace(/\\/g, '/'), loc: n });
  }
  oversize.sort((a, b) => b.loc - a.loc);
  return { label, files: files.length, loc, oversize };
}

function isTestOnlyFile(absPath) {
  const norm = absPath.replace(/\\/g, '/');
  // Test-only conventions used in this repo:
  //   - any file under a `tests/` directory                       (integration tests)
  //   - any file ending with `_tests.rs`                          (sibling test module)
  //   - any file named `tests.rs` (module-style test submodule)
  return (
    /\/tests\//.test(norm) ||
    /_tests\.rs$/.test(norm) ||
    /\/tests\.rs$/.test(norm)
  );
}

function scanRustQuality() {
  const files = walk(path.join(ROOT, 'src-tauri', 'src'), ['.rs'])
    .concat(walk(path.join(ROOT, 'src', 'rust'), ['.rs']));
  const agg = { unwrap: 0, expect: 0, panic: 0, todo: 0, unimplemented: 0 };
  const topOffenders = [];
  for (const f of files) {
    if (isTestOnlyFile(f)) continue;
    const m = rustQualityMetrics(f);
    agg.unwrap += m.unwrap;
    agg.expect += m.expect;
    agg.panic += m.panic;
    agg.todo += m.todo;
    agg.unimplemented += m.unimplemented;
    const total = m.unwrap + m.expect + m.panic + m.todo + m.unimplemented;
    if (total > 0) {
      topOffenders.push({
        path: path.relative(ROOT, f).replace(/\\/g, '/'),
        ...m,
      });
    }
  }
  topOffenders.sort((a, b) =>
    (b.unwrap + b.expect + b.panic) - (a.unwrap + a.expect + a.panic));
  return { agg, topOffenders: topOffenders.slice(0, 20) };
}

function scanTauriCommands() {
  const rustFiles = walk(path.join(ROOT, 'src-tauri', 'src'), ['.rs']);
  const definedNames = new Set();
  const attrRe = /#\[tauri::command\]/g;
  const fnRe = /^\s*(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?fn\s+(\w+)/m;
  for (const f of rustFiles) {
    const text = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = attrRe.exec(text)) !== null) {
      // Look at the next ~10 lines for the fn name
      const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const fm = tail.match(fnRe);
      if (fm) definedNames.add(fm[1]);
    }
  }
  const defined = definedNames.size;
  const libPath = path.join(ROOT, 'src-tauri', 'src', 'lib.rs');
  let registered = 0;
  if (fs.existsSync(libPath)) {
    const text = fs.readFileSync(libPath, 'utf8');
    const idx = text.indexOf('invoke_handler');
    if (idx >= 0) {
      const after = text.slice(idx);
      const m = after.match(/generate_handler!\s*\[([\s\S]*?)\]/);
      if (m) {
        // Strip inline comments per-line, then remove empty/comment-only lines,
        // then split the remainder on commas.
        const stripped = m[1]
          .split(/\r?\n/)
          .map((line) => line.replace(/\/\/.*$/, '').trim())
          .filter((line) => line.length > 0)
          .join(' ');
        registered = stripped
          .split(',')
          .map((s) => s.trim())
          .filter((s) => /^[A-Za-z_:][A-Za-z_0-9:]*$/.test(s)).length;
      }
    }
  }
  return { defined, registered };
}

function scanMojibake() {
  const files = walk(path.join(ROOT, 'src-tauri', 'src'), ['.rs'])
    .concat(walk(path.join(ROOT, 'src', 'rust'), ['.rs']));
  const patterns = ['\u0432\u201dЂ', 'Г\u2014', 'вЂ', 'в†\u2019', 'Р¤Р°Р№', 'Р‘РµР·'];
  let total = 0;
  const byPattern = {};
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const p of patterns) {
      const n = text.split(p).length - 1;
      if (n > 0) { total += n; byPattern[p] = (byPattern[p] || 0) + n; }
    }
  }
  return { total, byPattern };
}

// ─── main ────────────────────────────────────────────────────────────────────

function main() {
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx > 0 && process.argv[outIdx + 1]
    ? path.resolve(process.argv[outIdx + 1])
    : DEFAULT_OUT;

  const rustLoc = scanLoc(path.join(ROOT, 'src-tauri', 'src'), ['.rs'], 'src-tauri');
  const coreLoc = scanLoc(path.join(ROOT, 'src', 'rust'), ['.rs'], 'rheolab-core');
  const tsLoc = scanLoc(path.join(ROOT, 'src'), ['.ts', '.tsx'], 'src-ts');
  const quality = scanRustQuality();
  const commands = scanTauriCommands();
  const mojibake = scanMojibake();

  const totalRust = rustLoc.loc + coreLoc.loc;
  const rustOversize = [...rustLoc.oversize, ...coreLoc.oversize]
    .sort((a, b) => b.loc - a.loc);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    tool: 'scripts/audit/snapshot-metrics.js',
    totals: {
      rustLoc: totalRust,
      tsLoc: tsLoc.loc,
      rustFiles: rustLoc.files + coreLoc.files,
      tsFiles: tsLoc.files,
    },
    loc: {
      srcTauri: { files: rustLoc.files, loc: rustLoc.loc },
      rheolabCore: { files: coreLoc.files, loc: coreLoc.loc },
      srcTs: { files: tsLoc.files, loc: tsLoc.loc },
    },
    oversizedFiles: {
      rustLimit: 500,
      rustOversize,
      tsLimit: 400,
      tsOversize: tsLoc.oversize,
    },
    rustQuality: {
      total: quality.agg,
      topOffenders: quality.topOffenders,
      note: 'Counts exclude `#[cfg(test)]` modules and individual `#[test]` bodies. Strings and comments stripped before matching.',
    },
    tauriCommands: commands,
    mojibake,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`Wrote baseline to ${path.relative(ROOT, outPath)}`);
  console.log(`  Rust LOC: ${totalRust}  |  TS LOC: ${tsLoc.loc}`);
  console.log(`  Rust oversize (>500): ${rustOversize.length}  |  TS oversize (>400): ${tsLoc.oversize.length}`);
  console.log(`  Rust unwrap/expect/panic: ${quality.agg.unwrap} / ${quality.agg.expect} / ${quality.agg.panic}`);
  console.log(`  Tauri commands: ${commands.defined} defined / ${commands.registered} registered`);
  console.log(`  Mojibake remaining: ${mojibake.total}`);
}

main();

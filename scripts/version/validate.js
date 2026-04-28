#!/usr/bin/env node
/**
 * version:validate — read-only consistency check between /version.json and
 * its four dependents.
 *
 * Exits 0 only if every dependent file's stored version equals the SSoT.
 * Exits 1 with a colourised diff and a hint to run `npm run version:sync`
 * if any of them is out of sync, or if the SSoT itself is malformed
 * (broken JSON, bad SemVer, channel ↔ tag mismatch).
 *
 * This script never mutates anything. It is safe to wire into pre-commit
 * hooks, CI, and `prerelease:prepare`.
 */

'use strict';

const { C, snapshotAllVersions } = require('./lib');

function main() {
    let snapshot;
    try {
        snapshot = snapshotAllVersions();
    } catch (err) {
        console.error(`${C.red}${C.bold}[version:validate] FATAL${C.reset} ${err.message}`);
        console.error(
            `${C.yellow}[version:validate]${C.reset} ` +
            `Fix /version.json, then run \`npm run version:sync\`.`,
        );
        process.exit(1);
    }

    const { ssot, files } = snapshot;
    const expected = ssot.version;

    console.log(
        `${C.bold}[version:validate]${C.reset} SSoT version: ${C.green}${expected}${C.reset} ` +
        `${C.dim}(channel: ${ssot.channel})${C.reset}`,
    );

    let mismatched = 0;
    const widest = files.reduce((max, f) => Math.max(max, f.label.length), 0);

    for (const file of files) {
        const padded = file.label.padEnd(widest);
        if (file.actual === expected) {
            console.log(`  ${C.green}✓${C.reset} ${padded}  ${file.actual}`);
        } else {
            mismatched++;
            const actualText = file.actual === null
                ? `${C.red}<missing or unparseable>${C.reset}`
                : `${C.red}${file.actual}${C.reset}`;
            console.log(
                `  ${C.red}✗${C.reset} ${padded}  ${actualText} ` +
                `${C.dim}(expected ${C.reset}${C.green}${expected}${C.dim})${C.reset}`,
            );
        }
    }

    if (mismatched === 0) {
        console.log(
            `${C.green}${C.bold}[version:validate] ✓${C.reset} ` +
            `all ${files.length} dependents agree with /version.json.`,
        );
        process.exit(0);
    }

    console.error(
        `\n${C.red}${C.bold}[version:validate] FAILED${C.reset} — ` +
        `${mismatched}/${files.length} dependent(s) disagree with /version.json.`,
    );
    console.error(
        `${C.yellow}[version:validate]${C.reset} ` +
        `Run ${C.bold}npm run version:sync${C.reset} to repair, then commit the result.`,
    );
    process.exit(1);
}

main();

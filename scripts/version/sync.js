#!/usr/bin/env node
/**
 * version:sync — propagate /version.json into the four dependent files.
 *
 * Idempotent. Safe to invoke from prebuild hooks (`pretauri:dev`,
 * `prebuild:ci`, `prerelease:prepare`). Always succeeds unless the SSoT
 * itself is broken (missing / bad SemVer / channel mismatch); in that case it
 * exits with code 1 and a human-readable explanation.
 *
 * `version.ts` always gets re-written because it captures BUILD_DATE and
 * COMMIT_HASH, which change every run.
 */

'use strict';

const {
    C,
    readSsot,
    writePackageJsonVersion,
    writeTauriConfVersion,
    writeCargoTomlVersion,
    writeVersionTs,
} = require('./lib');

function main() {
    let ssot;
    try {
        ssot = readSsot();
    } catch (err) {
        console.error(`${C.red}${C.bold}[version:sync] FATAL${C.reset} ${err.message}`);
        process.exit(1);
    }

    const { version, channel } = ssot;
    console.log(
        `${C.bold}[version:sync]${C.reset} SSoT → ${C.green}${version}${C.reset} ` +
        `${C.dim}(channel: ${channel})${C.reset}`,
    );

    let mutated = 0;

    try {
        if (writePackageJsonVersion(version)) {
            console.log(`  ${C.cyan}↻${C.reset} package.json                  → ${version}`);
            mutated++;
        } else {
            console.log(`  ${C.dim}=${C.reset} package.json                  ${C.dim}already ${version}${C.reset}`);
        }

        if (writeTauriConfVersion(version)) {
            console.log(`  ${C.cyan}↻${C.reset} src-tauri/tauri.conf.json     → ${version}`);
            mutated++;
        } else {
            console.log(`  ${C.dim}=${C.reset} src-tauri/tauri.conf.json     ${C.dim}already ${version}${C.reset}`);
        }

        if (writeCargoTomlVersion(version)) {
            console.log(`  ${C.cyan}↻${C.reset} src-tauri/Cargo.toml          → ${version}`);
            mutated++;
        } else {
            console.log(`  ${C.dim}=${C.reset} src-tauri/Cargo.toml          ${C.dim}already ${version}${C.reset}`);
        }

        const tsResult = writeVersionTs(version);
        const tsTail = `${C.dim}(date=${tsResult.buildDate}, commit=${tsResult.commitHash})${C.reset}`;
        if (tsResult.changed) {
            console.log(`  ${C.cyan}↻${C.reset} src/lib/version.ts            → ${version} ${tsTail}`);
            mutated++;
        } else {
            console.log(`  ${C.dim}=${C.reset} src/lib/version.ts            ${C.dim}already ${version}${C.reset} ${tsTail}`);
        }
    } catch (err) {
        console.error(`${C.red}${C.bold}[version:sync] FATAL${C.reset} ${err.message}`);
        process.exit(1);
    }

    if (mutated === 0) {
        console.log(`${C.green}${C.bold}[version:sync] ✓${C.reset} all 4 files already in sync.`);
    } else {
        console.log(
            `${C.green}${C.bold}[version:sync] ✓${C.reset} ` +
            `${mutated}/4 file(s) updated to ${version}.`,
        );
    }
}

main();

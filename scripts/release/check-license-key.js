#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '../..');
const DEFAULT_KEY_PATH = 'src-tauri/keys/license_public.der';

// Hash of src-tauri/keys/dev_public.der. This is not secret: it is a public key.
const DEV_PUBLIC_KEY_SHA256 = '909caada43b28364371c9d63341b4c86c386ae7bb3ab4c5842cb6d4853ff02d7';

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--key-path') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('license key check: FAILED - --key-path requires a value');
      }
      result.keyPath = value;
      index += 1;
    }
  }
  return result;
}

function resolveFromRepo(inputPath) {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(repoRoot, inputPath);
}

function displayPath(filePath) {
  const relative = path.relative(repoRoot, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, '/');
  }
  return filePath;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toLowerCase();
}

function checkLicensePublicKey(options = {}) {
  const requestedPath = options.keyPath ?? DEFAULT_KEY_PATH;
  const absolutePath = resolveFromRepo(requestedPath);
  const readablePath = displayPath(absolutePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`license key check: FAILED - ${readablePath} not found`);
  }

  const sha256 = sha256File(absolutePath);
  if (sha256 === DEV_PUBLIC_KEY_SHA256) {
    throw new Error(
      'license key check: FAILED - license_public.der is the DEV public key; ' +
      'a release built with it accepts dev-signed licenses. Restore the ' +
      'production key before building.',
    );
  }

  return {
    keyPath: absolutePath,
    sha256,
  };
}

if (require.main === module) {
  try {
    const result = checkLicensePublicKey(parseArgs(process.argv.slice(2)));
    console.log(`license key check: OK (sha256=${result.sha256.slice(0, 12)}...)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

module.exports = {
  checkLicensePublicKey,
};

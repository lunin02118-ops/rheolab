#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { sign, randomUUID } from 'node:crypto';

const REQUEST_PREFIX = 'RL-REQ1:';
const ACTIVATION_PREFIX = 'RL-ACT1:';

function usage() {
  console.error(`Usage:
  node scripts/licensing/sign-offline-activation.mjs \\
    --request-file request.txt \\
    --license-key RHEO-XXXX-XXXX-XXXX \\
    --customer "Company" \\
    --private-key license_private.pem

Options:
  --request <code>          Offline request code pasted inline
  --request-file <path>     File containing the request code
  --license-key <key>       Required Corporate license/order key stored in the activation payload
  --customer <name>         Customer/company name
  --email <email>           Optional customer email
  --expires-at <null>       Backward-compatible option; Corporate offline licenses are perpetual
  --private-key <path>      RSA private key PEM. Alternatively set RHEOLAB_LICENSE_PRIVATE_KEY_PEM.
`);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function base64UrlDecode(text) {
  return Buffer.from(text, 'base64url');
}

function readRequestCode() {
  const inline = arg('--request');
  const file = arg('--request-file');
  if (inline) return inline;
  if (file) return readFileSync(file, 'utf8');
  throw new Error('Missing --request or --request-file');
}

function privateKeyPem() {
  const env = process.env.RHEOLAB_LICENSE_PRIVATE_KEY_PEM;
  if (env) return env;
  const path = arg('--private-key');
  if (path) return readFileSync(path, 'utf8');
  throw new Error('Missing --private-key or RHEOLAB_LICENSE_PRIVATE_KEY_PEM');
}

function decodeRequest(code) {
  const compact = code.replace(/\s+/g, '');
  if (!compact.startsWith(REQUEST_PREFIX)) {
    throw new Error(`Request code must start with ${REQUEST_PREFIX}`);
  }
  const json = base64UrlDecode(compact.slice(REQUEST_PREFIX.length)).toString('utf8');
  return JSON.parse(json);
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const request = decodeRequest(readRequestCode());
  const licenseKey = arg('--license-key');
  const customerName = arg('--customer');
  if (!licenseKey) throw new Error('Missing --license-key');
  if (!customerName) throw new Error('Missing --customer');

  const expiresAtArg = arg('--expires-at');
  if (expiresAtArg && expiresAtArg.toLowerCase() !== 'null') {
    throw new Error('Corporate offline licenses are perpetual; omit --expires-at or pass null');
  }

  const payloadObject = {
    id: `offline-${randomUUID()}`,
    type: 'corporate',
    customerName,
    email: arg('--email') || null,
    issuedAt: new Date().toISOString(),
    expiresAt: null,
    gracePeriodDays: 30,
    machineId: request.machineId,
    hardwareBound: true,
    permanent: true,
    seats: 1,
    key: licenseKey,
    activationMode: 'offline',
    offlineAllowed: true,
    fingerprintVersion: request.fingerprintVersion || 2,
  };

  const payload = JSON.stringify(payloadObject);
  const signature = sign('RSA-SHA256', Buffer.from(payload, 'utf8'), privateKeyPem()).toString('base64');
  const envelope = JSON.stringify({ payload, signature });
  process.stdout.write(`${ACTIVATION_PREFIX}${base64UrlEncode(envelope)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
}
